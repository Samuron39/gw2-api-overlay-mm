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
//! - area  (combat):       bare statechange-hendelser, og buff-påføring/-fjerning der src eller dst er NPC
//!                         eller deg selv. Buffs mellom andre spillere droppes, det samme gjør skadetreff.
//! - local (combat_local): alt, unntatt rene skadetreff (ikke statechange/aktivering/buff) fra andre enn deg.

use arcdps::{Agent, CombatEvent};
use std::ffi::c_void;
use std::net::UdpSocket;
use std::ptr::NonNull;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{channel, RecvTimeoutError, Sender};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};

const PORT: u16 = 47500;
const NPC_ELITE: u32 = 0xffff_ffff;

// Batching-grenser: det første som inntreffer utløser sending
const BATCH_BYTES: usize = 1200;
const BATCH_LINES: usize = 50;
const BATCH_WAIT: Duration = Duration::from_millis(30);
const HELLO_EVERY: Duration = Duration::from_secs(2);

static TX: Mutex<Option<Sender<String>>> = Mutex::new(None);
static SEQ: AtomicU64 = AtomicU64::new(0);

arcdps::arcdps_export! {
    name: "GW2 Overlay Bridge",
    sig: 0x4757_324F, // "GW2O"
    init: init,
    release: release,
    combat_local: combat_local,
    combat: combat_area,
}

fn init(_swapchain: Option<NonNull<c_void>>) -> Result<(), Box<dyn std::error::Error>> {
    let (tx, rx) = channel::<String>();
    *TX.lock().unwrap() = Some(tx);
    thread::spawn(move || {
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
                    if lines > 0 {
                        flush(&socket, &mut batch, &mut lines);
                    }
                    break;
                }
            }
        }
    });
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

fn release() {
    *TX.lock().unwrap() = None;
}

/// Legger linja i køen til sendertråden.
fn send(line: String) {
    if let Ok(guard) = TX.lock() {
        if let Some(tx) = guard.as_ref() {
            let _ = tx.send(line);
        }
    }
}

fn next_seq() -> u64 {
    SEQ.fetch_add(1, Ordering::Relaxed) + 1
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
/// Bare statechange, og buff-hendelser der NPC eller du selv er part. Buffs mellom andre spillere og skadetreff droppes.
fn combat_area(ev: Option<&CombatEvent>, src: Option<Agent>, dst: Option<Agent>, skill_name: Option<&'static str>, id: u64, _revision: u64) {
    if let Some(e) = ev {
        if e.is_statechange == 0 {
            let buff_event = e.buff == 1 || e.is_buff_remove != 0;
            let relevant = is_npc(&src) || is_npc(&dst) || is_self(&src) || is_self(&dst);
            if !buff_event || !relevant {
                return;
            }
        }
    }
    forward("area", ev, src, dst, skill_name, id);
}

fn forward(scope: &str, ev: Option<&CombatEvent>, src: Option<Agent>, dst: Option<Agent>, skill_name: Option<&'static str>, id: u64) {
    // Løpenummeret tas her, før køen, i samme tråd som ArcDPS kaller oss fra: rekkefølgen i køen følger "n".
    let n = next_seq();
    match ev {
        Some(e) => {
            let line = format!(
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
            );
            send(line);
        }
        None => {
            // ev == None: agent-registrering (src = agent, dst.self_ = 1 hvis det er deg) eller target-endring
            let line = format!(
                "{{\"t\":\"agent\",\"s\":\"{scope}\",\"n\":{n},\"id\":{id},\"src\":{},\"dst\":{},\"name\":\"{}\"}}\n",
                agent_json(&src),
                agent_json(&dst),
                esc(skill_name.unwrap_or(""))
            );
            send(line);
        }
    }
}
