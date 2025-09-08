#!/usr/bin/env python3
import argparse
import json
import socket
from contextlib import closing


def send_rcp(host: str, port: int, payload: dict, timeout: float = 5.0) -> dict:
    data = json.dumps(payload).encode("utf-8")
    header = f"{len(data)}\0".encode("utf-8")
    with closing(socket.socket(socket.AF_INET, socket.SOCK_STREAM)) as s:
        s.settimeout(timeout)
        s.connect((host, port))
        s.sendall(header + data)

        buf = b""
        while b"\0" not in buf:
            chunk = s.recv(1)
            if not chunk:
                raise RuntimeError("Connection closed before header delimiter")
            buf += chunk
        size_part, remainder = buf.split(b"\0", 1)
        try:
            size = int(size_part.decode("utf-8"))
        except Exception as exc:
            raise RuntimeError("Invalid header length returned from server") from exc

        body = remainder
        while len(body) < size:
            chunk = s.recv(size - len(body))
            if not chunk:
                raise RuntimeError("Connection closed before full body received")
            body += chunk
        return json.loads(body.decode("utf-8"))


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="wow.export RPC healthcheck")
    parser.add_argument("--host", default="127.0.0.1", help="RPC host (default: 127.0.0.1)")
    parser.add_argument("--port", type=int, default=17751, help="RPC port (default: 17751)")
    parser.add_argument("--timeout", type=float, default=5.0, help="Socket timeout seconds (default: 5.0)")
    parser.add_argument("--quiet", action="store_true", help="Quiet mode (exit status only)")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        cfg = send_rcp(args.host, args.port, {"id": "CONFIG_GET"}, timeout=args.timeout)
        casc = send_rcp(args.host, args.port, {"id": "GET_CASC_INFO"}, timeout=args.timeout)
        if not args.quiet:
            print("CONFIG_GET:", json.dumps(cfg, indent=2))
            print("GET_CASC_INFO:", json.dumps(casc, indent=2))
            print("OK")
        return 0
    except Exception as exc:
        if not args.quiet:
            print(f"ERROR: {exc}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

