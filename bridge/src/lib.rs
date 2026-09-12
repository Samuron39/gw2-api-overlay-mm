//! GW2 Overlay Bridge: ArcDPS-utvidelse som videresender kamphendelser til overlayen.
//! Sender én JSON-linje per hendelse over UDP til 127.0.0.1:47500. Leser ingenting selv,
//! alt kommer fra ArcDPS sitt offisielle utvidelsesgrensesnitt.

use arcdps::{Agent, CombatEvent};
use std::ffi::c_void;
use std::net::UdpSocket;
use std::ptr::NonNull;
use std::sync::mpsc::{channel, Sender};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};

const PORT: u16 = 47500;

static TX: Mutex<Option<Sender<String>>> = Mutex::new(None);

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
        let mut last_hello = Instant::now() - Duration::from_secs(10);
        loop {
            if last_hello.elapsed() >= Duration::from_secs(2) {
                let _ = socket.send(format!("{{\"t\":\"hello\",\"v\":1,\"arc\":\"{}\"}}\n", esc(arcdps::arcdps_version())).as_bytes());
                last_hello = Instant::now();
            }
            match rx.recv_timeout(Duration::from_millis(500)) {
                Ok(line) => {
                    let _ = socket.send(line.as_bytes());
                    // tøm køen raskt
                    while let Ok(more) = rx.try_recv() {
                        let _ = socket.send(more.as_bytes());
                    }
                }
                Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {}
                Err(_) => break,
            }
        }
    });
    Ok(())
}

fn release() {
    *TX.lock().unwrap() = None;
}

fn send(line: String) {
    if let Ok(guard) = TX.lock() {
        if let Some(tx) = guard.as_ref() {
            let _ = tx.send(line);
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

/// Lokale hendelser: alt som gjelder spilleren selv (buffs på deg, dine aktiveringer, dine treff).
fn combat_local(ev: Option<&CombatEvent>, src: Option<Agent>, dst: Option<Agent>, skill_name: Option<&'static str>, id: u64, _revision: u64) {
    forward("local", ev, src, dst, skill_name, id);
}

/// Områdehendelser: brukes til target-tilstand (buffs/conditions på fiender fra hvem som helst) og kampstart/-slutt.
fn combat_area(ev: Option<&CombatEvent>, src: Option<Agent>, dst: Option<Agent>, skill_name: Option<&'static str>, id: u64, _revision: u64) {
    // Begrens mengden: bare buff-hendelser og tilstandsendringer, ikke hvert eneste skadetreff fra andre
    if let Some(e) = ev {
        let interesting = e.is_statechange != 0 || e.buff == 1 || e.is_buff_remove != 0;
        if !interesting {
            return;
        }
    }
    forward("area", ev, src, dst, skill_name, id);
}

fn forward(scope: &str, ev: Option<&CombatEvent>, src: Option<Agent>, dst: Option<Agent>, skill_name: Option<&'static str>, id: u64) {
    match ev {
        Some(e) => {
            let line = format!(
                "{{\"t\":\"ev\",\"s\":\"{scope}\",\"id\":{id},\"time\":{},\"srcAgent\":{},\"dstAgent\":{},\"skill\":{},\"name\":\"{}\",\"value\":{},\"buffDmg\":{},\"overstack\":{},\"iff\":{},\"buff\":{},\"result\":{},\"act\":{},\"rem\":{},\"sc\":{},\"srcInst\":{},\"dstInst\":{},\"srcMaster\":{},\"dstMaster\":{},\"src\":{},\"dst\":{}}}\n",
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
                "{{\"t\":\"agent\",\"s\":\"{scope}\",\"id\":{id},\"src\":{},\"dst\":{},\"name\":\"{}\"}}\n",
                agent_json(&src),
                agent_json(&dst),
                esc(skill_name.unwrap_or(""))
            );
            send(line);
        }
    }
}
