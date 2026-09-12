// Leser Guild Wars 2 sin MumbleLink (delt minne, 5460 byte) og skriver én JSON-linje per oppdatering.
// Samme felt og layout som det gamle mumble.py, så src/mumble.js leser formatet uendret.

use serde_json::{json, Value};
use std::io::Write;
use std::thread::sleep;
use std::time::Duration;
use windows_sys::Win32::Foundation::{CloseHandle, GetLastError, HANDLE, INVALID_HANDLE_VALUE};
use windows_sys::Win32::System::Memory::{
    CreateFileMappingW, MapViewOfFile, UnmapViewOfFile, FILE_MAP_READ, MEMORY_MAPPED_VIEW_ADDRESS, PAGE_READWRITE,
};

const SIZE: usize = 5460;

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

fn u32_at(b: &[u8], off: usize) -> u32 {
    u32::from_le_bytes([b[off], b[off + 1], b[off + 2], b[off + 3]])
}
fn f32_at(b: &[u8], off: usize) -> f32 {
    f32::from_le_bytes([b[off], b[off + 1], b[off + 2], b[off + 3]])
}
fn vec3_at(b: &[u8], off: usize) -> [f32; 3] {
    [f32_at(b, off), f32_at(b, off + 4), f32_at(b, off + 8)]
}
// UTF-16LE-streng fram til første NUL; ugyldige tegn hoppes over (som Python sin "ignore").
fn wstr_at(b: &[u8], off: usize, bytes: usize) -> String {
    let units: Vec<u16> = b[off..off + bytes]
        .chunks_exact(2)
        .map(|c| u16::from_le_bytes([c[0], c[1]]))
        .take_while(|&u| u != 0)
        .collect();
    char::decode_utf16(units).filter_map(Result::ok).collect()
}

fn print_line(v: &Value) {
    let mut out = std::io::stdout().lock();
    let _ = writeln!(out, "{}", v);
    let _ = out.flush();
}

struct Mapping {
    handle: HANDLE,
    view: *const u8,
}

impl Mapping {
    // Samme oppførsel som Python sin mmap(-1, SIZE, "MumbleLink"): åpner den delte blokka hvis den finnes,
    // ellers opprettes den, slik at spillet skriver inn i den når det starter senere.
    fn open() -> Result<Mapping, String> {
        let name = wide("MumbleLink");
        unsafe {
            let handle = CreateFileMappingW(INVALID_HANDLE_VALUE, std::ptr::null(), PAGE_READWRITE, 0, SIZE as u32, name.as_ptr());
            if handle.is_null() {
                return Err(format!("CreateFileMapping feilet ({})", GetLastError()));
            }
            let view = MapViewOfFile(handle, FILE_MAP_READ, 0, 0, SIZE);
            if view.Value.is_null() {
                let e = GetLastError();
                CloseHandle(handle);
                return Err(format!("MapViewOfFile feilet ({})", e));
            }
            Ok(Mapping { handle, view: view.Value as *const u8 })
        }
    }

    fn read(&self, buf: &mut [u8; SIZE]) {
        unsafe { std::ptr::copy_nonoverlapping(self.view, buf.as_mut_ptr(), SIZE) };
    }
}

impl Drop for Mapping {
    fn drop(&mut self) {
        unsafe {
            UnmapViewOfFile(MEMORY_MAPPED_VIEW_ADDRESS { Value: self.view as *mut _ });
            CloseHandle(self.handle);
        }
    }
}

fn state_from(buf: &[u8; SIZE], ui_tick: u32) -> Value {
    let name = wstr_at(buf, 44, 512);
    let identity_raw = wstr_at(buf, 592, 512);
    let identity: Value = if identity_raw.is_empty() {
        Value::Null
    } else {
        serde_json::from_str(&identity_raw).unwrap_or(Value::Null)
    };
    // GW2 sin context-layout (MumbleContext), 256 byte fra offset 1108
    let ctx = &buf[1108..1108 + 256];
    let map_id = u32_at(ctx, 28);
    let map_type = u32_at(ctx, 32);
    let shard_id = u32_at(ctx, 36);
    let instance = u32_at(ctx, 40);
    let build_id = u32_at(ctx, 44);
    let ui_state = u32_at(ctx, 48);
    // 52: compass-bredde/høyde (u16), 56: compass-rotasjon (f32), 68-76: kartsenter og skala, 80: prosess-id
    let player_x = f32_at(ctx, 60);
    let player_y = f32_at(ctx, 64);
    let mount = ctx[84];
    json!({
        "running": name == "Guild Wars 2",
        "tick": ui_tick,
        "mapId": map_id, "mapType": map_type, "shardId": shard_id, "instance": instance, "buildId": build_id,
        "ui": {
            "mapOpen": ui_state & 1 != 0, "compassTopRight": ui_state & 2 != 0, "compassRotation": ui_state & 4 != 0,
            "gameFocus": ui_state & 8 != 0, "competitive": ui_state & 16 != 0, "textboxFocus": ui_state & 32 != 0,
            "inCombat": ui_state & 64 != 0,
        },
        "avatar": { "pos": vec3_at(buf, 8), "front": vec3_at(buf, 20) },
        "camera": { "pos": vec3_at(buf, 556), "front": vec3_at(buf, 568) },
        "mapPos": [player_x, player_y],  // kontinentkoordinater
        "mount": mount,
        "identity": identity,
    })
}

// Leser så lenge blokka er åpen; returnerer aldri normalt.
fn read_loop(m: &Mapping) {
    let mut buf = [0u8; SIZE];
    let mut last_tick: Option<u32> = None;
    loop {
        m.read(&mut buf);
        let ui_tick = u32_at(&buf, 4);
        if last_tick == Some(ui_tick) {
            // spillet oppdaterer ikke, sannsynligvis ikke i gang
            print_line(&json!({ "running": false }));
            sleep(Duration::from_secs(2));
            continue;
        }
        last_tick = Some(ui_tick);
        print_line(&state_from(&buf, ui_tick));
        sleep(Duration::from_millis(500));
    }
}

pub fn run() -> i32 {
    loop {
        match Mapping::open() {
            Ok(m) => read_loop(&m),
            Err(e) => {
                print_line(&json!({ "running": false, "error": format!("MumbleLink ikke tilgjengelig: {}", e) }));
                sleep(Duration::from_secs(3));
            }
        }
    }
}
