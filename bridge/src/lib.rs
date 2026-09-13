//! GW2 Overlay Bridge: ArcDPS-utvidelse som videresender kamphendelser til overlayen.
//! Leser ingenting selv, alt kommer fra ArcDPS sitt offisielle utvidelsesgrensesnitt.
//!
//! PROTOKOLL (UDP til 127.0.0.1:47500, UTF-8, én JSON-linje per hendelse, linjer adskilt med "\n")
//!
//! Batching: sendertråden samler linjer og sender ett datagram når det første av dette inntreffer:
//! ~1200 byte, 50 linjer eller 30 ms siden første linje i bufferet. Mottakeren splitter på "\n".
//! En enkeltlinje som er lengre enn grensa sendes alene. Hello sendes som eget datagram hvert 2. sekund.
//!
//! Linjetyper (felt "t"):
//! - hello:  {"t":"hello","v":1,"arc":"<arcdps-versjon>"}        livstegn, hvert 2. sekund
//! - ev:     {"t":"ev","s":"local"|"area","n":<seq>,"id":<arc-id>,"time":<ms>,"srcAgent","dstAgent","skill",
//!            "name","value","buffDmg","overstack","iff","buff","result","act","rem","sc",
//!            "srcInst","dstInst","srcMaster","dstMaster","src":<agent|null>,"dst":<agent|null>}
//!           Feltene speiler cbtevent i ArcDPS: act = is_activation, rem = is_buff_remove, sc = is_statechange.
//! - agent:  {"t":"agent","s":..,"n":<seq>,"id":<arc-id>,"src":<agent|null>,"dst":<agent|null>,"name":".."}
//!           ev == None i ArcDPS: agent-registrering (dst.self = 1 når src er deg) eller target-endring.
//! Agent:    {"id","name","prof","elite","self","team"}. elite == 4294967295 (0xffffffff) betyr NPC/gadget.
//!
//! "n" er broens egen løpende teller for sendte linjer (hello unntatt). Hopp i "n" hos mottakeren betyr
//! tapte datagram. "id" er ArcDPS sin hendelses-id og får hull fordi broen filtrerer.
//!
//! Filtrering før sending:
//! - area  (combat):       alt der du selv er src eller dst droppes (local dekker det, ellers kom det dobbelt).
//!                         Ellers bare statechange-hendelser, og buff-påføring (buff == 1 uten buff_dmg) eller
//!                         buff-fjerning der src eller dst er NPC. Buffs mellom andre spillere, condition-ticks
//!                         og skadetreff droppes.
//! - local (combat_local): alt, unntatt rene skadetreff (ikke statechange/aktivering/buff) fra andre enn deg.

use arcdps::{helpers, Agent, ArcDpsExport, CombatEvent, RawAgent};
use std::ffi::{c_char, c_void, CString};
use std::net::UdpSocket;
use std::ptr::NonNull;
use std::sync::mpsc::{channel, RecvTimeoutError, Sender};
use std::sync::Mutex;
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

const PORT: u16 = 47500;
const NPC_ELITE: u32 = 0xffff_ffff;

// Batching-grenser: det første som inntreffer utløser sending
const BATCH_BYTES: usize = 1200;
const BATCH_LINES: usize = 50;
const BATCH_WAIT: Duration = Duration::from_millis(30);
const HELLO_EVERY: Duration = Duration::from_secs(2);

/// Køen til sendertråden pluss løpenummeret "n". Begge bak samme lås, så rekkefølgen i køen alltid følger n.
struct Queue {
    tx: Sender<String>,
    seq: u64,
}

static TX: Mutex<Option<Queue>> = Mutex::new(None);
static SENDER: Mutex<Option<JoinHandle<()>>> = Mutex::new(None);

// ---------- Eksporten ArcDPS leter etter ----------
// Skrevet for hånd i stedet for arcdps_export!-makroen: makroen oppgir imgui 1.80 (18000) i eksporttabellen, men
// ArcDPS avviser utvidelser som ikke oppgir samme imgui-versjon som ArcDPS selv er bygget med (1.92.7 i 2026,
// ARCDPSEXTENLOAD_INVALID_IMGUI). ArcDPS sender sin egen versjon som siste argument til get_init_addr, og vi
// gir den tilbake uendret. Broen tegner ingenting med imgui, så versjonen spiller ellers ingen rolle.
const SIG: u32 = 0x4757_324F; // "GW2O", unik id for ArcDPS
static NAME: &[u8] = b"GW2 Overlay Bridge\0";
static BUILD: &[u8] = concat!(env!("CARGO_PKG_VERSION"), "\0").as_bytes();

static mut EXPORT: ArcDpsExport = ArcDpsExport {
    size: std::mem::size_of::<ArcDpsExport>(),
    sig: SIG,
    imgui_version: 0, // settes i get_init_addr
    out_name: NAME.as_ptr(),
    out_build: BUILD.as_ptr(),
    wnd_nofilter: None,
    combat: Some(raw_combat_area),
    imgui: None,
    options_end: None,
    combat_local: Some(raw_combat_local),
    wnd_filter: None,
    options_windows: None,
};

unsafe extern "C" fn raw_combat_local(ev: Option<&CombatEvent>, src: Option<&RawAgent>, dst: Option<&RawAgent>, skill_name: *mut c_char, id: u64, revision: u64) {
    let a = helpers::get_combat_args_from_raw(ev, src, dst, skill_name);
    combat_local(a.ev, a.src, a.dst, a.skill_name, id, revision)
}

unsafe extern "C" fn raw_combat_area(ev: Option<&CombatEvent>, src: Option<&RawAgent>, dst: Option<&RawAgent>, skill_name: *mut c_char, id: u64, revision: u64) {
    let a = helpers::get_combat_args_from_raw(ev, src, dst, skill_name);
    combat_area(a.ev, a.src, a.dst, a.skill_name, id, revision)
}

/// Linje i arcdps.log (e3), så det er lett å se at broen ble lastet
fn arc_log(msg: &str) {
    if let Ok(c) = CString::new(msg) {
        unsafe { arcdps::e3(c.as_ptr() as *mut u8) };
    }
}

unsafe extern "system" fn load() -> *const ArcDpsExport {
    let _ = init(None);
    let imgui = *&raw const EXPORT.imgui_version; // rå peker, ingen delt referanse til static mut
    arc_log(&format!("GW2 Overlay Bridge {}: lastet, sender til 127.0.0.1:{} (imgui {})", env!("CARGO_PKG_VERSION"), PORT, imgui));
    &raw const EXPORT
}

unsafe extern "system" fn unload() {
    release();
}

/// ArcDPS kaller denne ved lasting: arcversionstr, imguicontext, id3dptr, arcdll, mallocfn, freefn, imguiversion
#[no_mangle]
pub unsafe extern "system" fn get_init_addr(
    arc_version: *mut c_char,
    _imgui_ctx: *mut c_void,
    _id3d: *mut c_void,
    arc_dll: *mut c_void,
    _malloc: *mut c_void,
    _free: *mut c_void,
    imgui_version: u32,
) -> unsafe extern "system" fn() -> *const ArcDpsExport {
    EXPORT.imgui_version = imgui_version;
    arcdps::__init(arc_version, arc_dll, "GW2 Overlay Bridge");
    load
}

#[no_mangle]
pub extern "system" fn get_release_addr() -> unsafe extern "system" fn() {
    unload
}

fn init(_swapchain: Option<NonNull<c_void>>) -> Result<(), Box<dyn std::error::Error>> {
    let (tx, rx) = channel::<String>();
    *TX.lock().unwrap() = Some(Queue { tx, seq: 0 });
    let handle = thread::spawn(move || {
        let socket = match UdpSocket::bind("127.0.0.1:0") {
            Ok(s) => s,
            Err(_) => return,
        };
        let _ = socket.connect(("127.0.0.1", PORT));
        let mut last_hello = Instant::now() - HELLO_EVERY;
        let mut batch = String::with_capacity(BATCH_BYTES + 512);
        let mut lines = 0usize;
        let mut first_at = Instant::now(); // når første linje i bufferet kom
        loop {
            if last_hello.elapsed() >= HELLO_EVERY {
                let _ = socket.send(format!("{{\"t\":\"hello\",\"v\":1,\"arc\":\"{}\"}}\n", esc(arcdps::arcdps_version())).as_bytes());
                last_hello = Instant::now();
            }
            // Vent kortere når det ligger noe i bufferet, så 30 ms-grensa holdes
            let wait = if lines > 0 { BATCH_WAIT.saturating_sub(first_at.elapsed()) } else { Duration::from_millis(500) };
            match rx.recv_timeout(wait) {
                Ok(line) => {
                    if lines > 0 && batch.len() + line.len() > BATCH_BYTES {
                        flush(&socket, &mut batch, &mut lines);
                    }
                    if lines == 0 {
                        first_at = Instant::now();
                    }
                    batch.push_str(&line);
                    lines += 1;
                    if lines >= BATCH_LINES || batch.len() >= BATCH_BYTES || first_at.elapsed() >= BATCH_WAIT {
                        flush(&socket, &mut batch, &mut lines);
                    }
                }
                Err(RecvTimeoutError::Timeout) => {
                    if lines > 0 {
                        flush(&socket, &mut batch, &mut lines);
                    }
                }
                Err(RecvTimeoutError::Disconnected) => {
                    // Senderen er droppet (release): send det som ligger igjen og avslutt
                    if lines > 0 {
                        flush(&socket, &mut batch, &mut lines);
                    }
                    break;
                }
            }
        }
    });
    *SENDER.lock().unwrap() = Some(handle);
    Ok(())
}

/// Sender bufferet som ett datagram og tømmer det.
fn flush(socket: &UdpSocket, batch: &mut String, lines: &mut usize) {
    if !batch.is_empty() {
        let _ = socket.send(batch.as_bytes());
    }
    batch.clear();
    *lines = 0;
}

/// Avslutning: dropp senderen så tråden får Disconnected etter at køen er tømt, og vent på at den har sendt siste batch.
/// Låsen på TX holdes ikke under join, så en sen combat-callback fra ArcDPS bare mister linja si.
fn release() {
    if let Ok(mut guard) = TX.lock() {
        *guard = None;
    }
    let handle = SENDER.lock().ok().and_then(|mut g| g.take());
    if let Some(h) = handle {
        let _ = h.join();
    }
}

/// Legger linja i køen til sendertråden. Løpenummeret tas inne i låsen, så rekkefølgen i køen alltid følger "n".
fn send(build: impl FnOnce(u64) -> String) {
    if let Ok(mut guard) = TX.lock() {
        if let Some(q) = guard.as_mut() {
            q.seq += 1;
            let _ = q.tx.send(build(q.seq));
        }
    }
}

fn esc(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' | '\r' | '\t' => out.push(' '),
            c if (c as u32) < 0x20 => {}
            c => out.push(c),
        }
    }
    out
}

fn agent_json(a: &Option<Agent>) -> String {
    match a {
        Some(a) => format!(
            "{{\"id\":{},\"name\":\"{}\",\"prof\":{},\"elite\":{},\"self\":{},\"team\":{}}}",
            a.id,
            esc(a.name.unwrap_or("")),
            a.prof,
            a.elite,
            a.self_,
            a.team
        ),
        None => "null".to_string(),
    }
}

fn is_self(a: &Option<Agent>) -> bool {
    a.as_ref().map_or(false, |a| a.self_ == 1)
}

fn is_npc(a: &Option<Agent>) -> bool {
    a.as_ref().map_or(false, |a| a.elite == NPC_ELITE)
}

/// Lokale hendelser: alt som gjelder spilleren selv (buffs på deg, dine aktiveringer, dine treff).
/// Rene skadetreff fra andre enn deg droppes, de brukes ikke i overlayen.
fn combat_local(ev: Option<&CombatEvent>, src: Option<Agent>, dst: Option<Agent>, skill_name: Option<&'static str>, id: u64, _revision: u64) {
    if let Some(e) = ev {
        let plain_hit = e.is_statechange == 0 && e.is_activation == 0 && e.is_buff_remove == 0 && e.buff == 0;
        if plain_hit && !is_self(&src) {
            return;
        }
    }
    forward("local", ev, src, dst, skill_name, id);
}

/// Områdehendelser: brukes til target-tilstand (buffs/conditions på fiender fra hvem som helst) og kampstart/-slutt.
/// Alt der du selv er part droppes: combat_local leverer de samme hendelsene, og to leveringer ga doble stacks.
/// Ellers bare statechange, og buff-påføring (buff == 1 uten buff_dmg) eller buff-fjerning der en NPC er part.
/// Condition-ticks (buff_dmg != 0), buffs mellom andre spillere og skadetreff droppes.
fn combat_area(ev: Option<&CombatEvent>, src: Option<Agent>, dst: Option<Agent>, skill_name: Option<&'static str>, id: u64, _revision: u64) {
    if let Some(e) = ev {
        if is_self(&src) || is_self(&dst) {
            return;
        }
        if e.is_statechange == 0 {
            let buff_event = (e.buff == 1 && e.buff_dmg == 0) || e.is_buff_remove != 0;
            let relevant = is_npc(&src) || is_npc(&dst);
            if !buff_event || !relevant {
                return;
            }
        }
    }
    forward("area", ev, src, dst, skill_name, id);
}

fn forward(scope: &str, ev: Option<&CombatEvent>, src: Option<Agent>, dst: Option<Agent>, skill_name: Option<&'static str>, id: u64) {
    // Løpenummeret "n" deles ut av send() inne i kølåsen, så rekkefølgen i køen alltid følger n.
    match ev {
        Some(e) => send(|n| {
            format!(
                "{{\"t\":\"ev\",\"s\":\"{scope}\",\"n\":{n},\"id\":{id},\"time\":{},\"srcAgent\":{},\"dstAgent\":{},\"skill\":{},\"name\":\"{}\",\"value\":{},\"buffDmg\":{},\"overstack\":{},\"iff\":{},\"buff\":{},\"result\":{},\"act\":{},\"rem\":{},\"sc\":{},\"srcInst\":{},\"dstInst\":{},\"srcMaster\":{},\"dstMaster\":{},\"src\":{},\"dst\":{}}}\n",
                e.time,
                e.src_agent,
                e.dst_agent,
                e.skill_id,
                esc(skill_name.unwrap_or("")),
                e.value,
                e.buff_dmg,
                e.overstack_value,
                e.iff,
                e.buff,
                e.result,
                e.is_activation,
                e.is_buff_remove,
                e.is_statechange,
                e.src_instance_id,
                e.dst_instance_id,
                e.src_master_instance_id,
                e.dst_master_instance_id,
                agent_json(&src),
                agent_json(&dst),
            )
        }),
        None => send(|n| {
            // ev == None: agent-registrering (src = agent, dst har prof/elite/self, dst.self_ = 1 hvis det er deg)
            // eller target-endring (src.elite = 0xffffffff, src.id = nytt mål, dst = None)
            format!(
                "{{\"t\":\"agent\",\"s\":\"{scope}\",\"n\":{n},\"id\":{id},\"src\":{},\"dst\":{},\"name\":\"{}\"}}\n",
                agent_json(&src),
                agent_json(&dst),
                esc(skill_name.unwrap_or(""))
            )
        }),
    }
}
