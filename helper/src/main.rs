// Hjelper for GW2 Overlay. Erstatter de gamle Python-skriptene.
//
//   gw2overlay_helper mumble                            leser MumbleLink og skriver én JSON-linje per oppdatering
//   gw2overlay_helper paste [--no-enter] [--dry-run]    gir GW2 fokus og limer inn utklippstavla i chatten
//
// Leser bare det spillet selv eksponerer i delt minne, skriver aldri til spillet.

mod mumble;
mod paste;

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let code = match args.first().map(String::as_str) {
        Some("mumble") => mumble::run(),
        Some("paste") => paste::run(&args[1..]),
        _ => {
            eprintln!("Bruk: gw2overlay_helper mumble | paste [--no-enter] [--dry-run]");
            64
        }
    };
    std::process::exit(code);
}
