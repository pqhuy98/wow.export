#!/usr/bin/env python3
import argparse, json, os, socket, sys, time

def recv_msg(s: socket.socket) -> dict:
    buf = b""
    while b"\0" not in buf:
        buf += s.recv(1)
    size_s, rest = buf.split(b"\0", 1)
    size = int(size_s.decode("utf-8"))
    body = rest
    while len(body) < size:
        body += s.recv(size - len(body))
    return json.loads(body.decode("utf-8"))

def send_cmd(s: socket.socket, cmd: str, expect: tuple[str, ...], timeout: float | None = 30.0, **data) -> dict:
    payload = {"id": cmd, **data}
    body = json.dumps(payload).encode("utf-8")
    s.settimeout(timeout)
    s.sendall(f"{len(body)}\0".encode("utf-8") + body)
    start = time.time()
    while True:
        if timeout is not None and time.time() - start > timeout:
            raise TimeoutError(cmd)
        resp = recv_msg(s)
        if resp.get("id") in expect:
            return resp

def connect(host: str, port: int, timeout: float | None = 30.0) -> socket.socket:
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.settimeout(timeout)
    s.connect((host, port))
    return s

def wait_rpc(host: str, port: int, wait: int):
    deadline = time.time() + wait
    while time.time() < deadline:
        try:
            s = connect(host, port, 5)
            send_cmd(s, "CONFIG_GET", ("CONFIG_SINGLE","CONFIG_FULL"), 5)
            s.close(); return
        except Exception:
            time.sleep(1)
    raise RuntimeError("RPC not ready")

def choose_index(builds: list[dict], product: str | None) -> int:
    if product:
        for i, b in enumerate(builds or []):
            if b.get("Product") == product: return i
    return 0

def main():
    p = argparse.ArgumentParser()
    p.add_argument("--host", default=os.environ.get("WOWEXPORT_HOST","127.0.0.1"))
    p.add_argument("--port", type=int, default=int(os.environ.get("WOWEXPORT_PORT",17751)))
    p.add_argument("--wait", type=int, default=int(os.environ.get("WAIT_SECONDS",60)))
    a = p.parse_args(); t0 = time.time()

    print(f"Waiting for wow.export RPC at {a.host}:{a.port}...")
    wait_rpc(a.host, a.port, a.wait)

    # Already loaded?
    s = connect(a.host, a.port)
    r = send_cmd(s, "GET_CASC_INFO", ("CASC_INFO","CASC_UNAVAILABLE"))
    s.close()
    if r.get("id") == "CASC_INFO":
        print(f"CASC already loaded: {r['build']['Product']} {r['buildName']}")
        print(f"Elapsed: {time.time()-t0:.1f}s"); return 0

    # Local
    if os.environ.get("CASC_LOCAL_WOW"):
        install = os.environ["CASC_LOCAL_WOW"]; product = os.environ.get("CASC_LOCAL_PRODUCT","")
        print(f"Attempting local CASC: path={install!r} product={product!r}")
        s = connect(a.host, a.port)
        resp = send_cmd(s, "LOAD_CASC_LOCAL", ("CASC_INSTALL_BUILDS","ERR_INVALID_INSTALL","ERR_CASC_ACTIVE"), 30, installDirectory=install)
        if resp.get("id") == "ERR_CASC_ACTIVE":
            ok = send_cmd(s, "GET_CASC_INFO", ("CASC_INFO",), 30)
            print(f"✅ CASC ready: {ok['build']['Product']} {ok['buildName']}")
            print(f"Elapsed: {time.time()-t0:.1f}s"); s.close(); return 0
        idx = choose_index(resp.get("builds", []), product)
        print(f"Selected local build index={idx}: {resp.get('builds', [])[idx] if resp.get('builds') else '{}'}")
        send_cmd(s, "LOAD_CASC_BUILD", ("CASC_INFO","ERR_NO_CASC_SETUP","ERR_INVALID_CASC_BUILD","ERR_CASC_FAILED"), None, buildIndex=idx)
        s.close(); s = connect(a.host, a.port)
        ok = send_cmd(s, "GET_CASC_INFO", ("CASC_INFO",), 600)
        print(f"✅ CASC ready: {ok['build']['Product']} {ok['buildName']}")
        print(f"Elapsed: {time.time()-t0:.1f}s"); s.close(); return 0

    # Remote
    if os.environ.get("CASC_REMOTE_REGION") and os.environ.get("CASC_REMOTE_PRODUCT"):
        region = os.environ["CASC_REMOTE_REGION"]; product = os.environ["CASC_REMOTE_PRODUCT"]
        print(f"Attempting remote CASC: region={region!r} product={product!r}")
        s = connect(a.host, a.port)
        resp = send_cmd(s, "LOAD_CASC_REMOTE", ("CASC_INSTALL_BUILDS","ERR_INVALID_INSTALL","ERR_CASC_ACTIVE"), 30, regionTag=region)
        idx = choose_index(resp.get("builds", []), product)
        print(f"Selected remote build index={idx}: {resp.get('builds', [])[idx] if resp.get('builds') else '{}'}")
        send_cmd(s, "LOAD_CASC_BUILD", ("CASC_INFO","ERR_NO_CASC_SETUP","ERR_INVALID_CASC_BUILD","ERR_CASC_FAILED"), None, buildIndex=idx)
        s.close(); s = connect(a.host, a.port)
        ok = send_cmd(s, "GET_CASC_INFO", ("CASC_INFO",), 600)
        print(f"✅ CASC ready: {ok['build']['Product']} {ok['buildName']}")
        print(f"Elapsed: {time.time()-t0:.1f}s"); s.close(); return 0

    print("CASC not configured. Set CASC_LOCAL_WOW/CASC_LOCAL_PRODUCT or CASC_REMOTE_REGION/CASC_REMOTE_PRODUCT.", file=sys.stderr)
    print(f"Elapsed: {time.time()-t0:.1f}s"); return 1

if __name__ == "__main__":
    raise SystemExit(main())

