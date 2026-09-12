# Leser Guild Wars 2 sin MumbleLink (delt minne) og skriver en JSON-linje per oppdatering.
# Kjøres som underprosess fra Electron. Ingen skriving til spillet, kun lesing av det spillet selv eksponerer.
import mmap, struct, json, sys, time, ctypes

SIZE = 5460
def read_state():
    try:
        mm = mmap.mmap(-1, SIZE, "MumbleLink")
    except Exception as e:
        return None
    last_tick = -1
    last_identity = None
    try:
        while True:
            mm.seek(0)
            buf = mm.read(SIZE)
            ui_version, ui_tick = struct.unpack_from("<II", buf, 0)
            if ui_tick == last_tick:
                # spillet oppdaterer ikke, sannsynligvis ikke i gang
                print(json.dumps({"running": False}), flush=True)
                time.sleep(2)
                continue
            last_tick = ui_tick
            av_pos = struct.unpack_from("<3f", buf, 8)
            av_front = struct.unpack_from("<3f", buf, 20)
            name = buf[44:44+512].decode("utf-16-le", "ignore").split("\0")[0]
            cam_pos = struct.unpack_from("<3f", buf, 556)
            cam_front = struct.unpack_from("<3f", buf, 568)
            identity_raw = buf[592:592+512].decode("utf-16-le", "ignore").split("\0")[0]
            identity = None
            if identity_raw:
                try:
                    identity = json.loads(identity_raw)
                except Exception:
                    identity = None
            ctx_len = struct.unpack_from("<I", buf, 1104)[0]
            ctx = buf[1108:1108+256]
            # GW2 context-layout (MumbleContext)
            map_id, map_type, shard_id, instance, build_id, ui_state = struct.unpack_from("<IIIIII", ctx, 28)
            compass_w, compass_h = struct.unpack_from("<HH", ctx, 52)
            compass_rot = struct.unpack_from("<f", ctx, 56)[0]
            player_x, player_y, map_center_x, map_center_y, map_scale = struct.unpack_from("<5f", ctx, 60)
            process_id = struct.unpack_from("<I", ctx, 80)[0]
            mount = ctx[84]
            state = {
                "running": name == "Guild Wars 2",
                "tick": ui_tick,
                "mapId": map_id, "mapType": map_type, "shardId": shard_id, "instance": instance, "buildId": build_id,
                "ui": {
                    "mapOpen": bool(ui_state & 1), "compassTopRight": bool(ui_state & 2), "compassRotation": bool(ui_state & 4),
                    "gameFocus": bool(ui_state & 8), "competitive": bool(ui_state & 16), "textboxFocus": bool(ui_state & 32),
                    "inCombat": bool(ui_state & 64),
                },
                "avatar": {"pos": av_pos, "front": av_front},
                "camera": {"pos": cam_pos, "front": cam_front},
                "mapPos": [player_x, player_y],  # kontinentkoordinater
                "mount": mount,
                "identity": identity,
            }
            print(json.dumps(state), flush=True)
            time.sleep(0.5)
    finally:
        mm.close()

if __name__ == "__main__":
    while True:
        r = read_state()
        if r is None:
            print(json.dumps({"running": False, "error": "MumbleLink ikke tilgjengelig"}), flush=True)
            time.sleep(3)
