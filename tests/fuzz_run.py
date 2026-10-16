"""Fuzz-Test für Rundung/Fase (siehe tests/fuzzlib.js).

  python tests/fuzz_run.py --cases 1000 [--start 0] [--procs 6] [--recycle 1]

Startet einen lokalen Server und headless Edge mit tests/fuzz.html?from=..&n=.. (Fälle laufen in Workern), sammelt die Ergebnisse in
tests/fuzz-out/results.jsonl und gibt die Fehlergruppen (Prüfregel · Ort · Rundung/Fase) nach Häufigkeit aus.
Einen Fall ansehen: tests/fuzz.html?case=<Nummer>&view
"""
import argparse, collections, functools, http.server, json, os, shutil, socketserver, subprocess, sys, tempfile, threading, time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'tests', 'fuzz-out')
EDGE = next(p for p in [r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe', r'C:\Program Files\Microsoft\Edge\Application\msedge.exe'] if os.path.exists(p))


RESULTS, DONE = [], threading.Condition()
FINISHED = threading.Event()


def serve():
    class Handler(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a): pass

        def do_POST(self):
            body = json.loads(self.rfile.read(int(self.headers['Content-Length'])).decode('utf-8'))
            self.send_response(204)
            self.end_headers()
            with DONE:
                RESULTS.extend(body['results'])
                if body['last']: FINISHED.set()
                DONE.notify_all()
    srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), functools.partial(Handler, directory=ROOT))
    srv.daemon_threads = True
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv.server_address[1]


def run(port, start, n, workers, t0, recycle):
    """Eine Edge-Instanz; die Seite verteilt die Fälle auf Worker und meldet die Ergebnisse stückweise."""
    prof = tempfile.mkdtemp(prefix='fuzz-edge-')
    url = f'http://127.0.0.1:{port}/tests/fuzz.html?from={start}&n={n}&workers={workers}&recycle={recycle}&post=1'
    p = subprocess.Popen([EDGE, '--headless=new', '--disable-gpu', '--no-first-run', '--remote-debugging-port=0', f'--user-data-dir={prof}', url],
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        last = -1
        with DONE:
            while not FINISHED.is_set():
                if not DONE.wait(600) and len(RESULTS) == last:
                    print('\nkeine Ergebnisse mehr seit 10 Minuten – Abbruch')
                    break
                last = len(RESULTS)
                print(f'\r{len(RESULTS)}/{n} Fälle, {sum(r["fail"] for r in RESULTS)} mit Fehler, {time.time() - t0:.0f}s', end='', flush=True)
    finally:
        p.kill()
        p.wait()
        time.sleep(1)
        shutil.rmtree(prof, ignore_errors=True)
    print()
    return list(RESULTS)


def groups(results):
    g = collections.defaultdict(list)
    for r in results:
        for s in r.get('steps', []):
            for code in (s.get('codes') or {}):
                g[(code, (s.get('sig') or {}).get(code, '-'), s.get('kind', '-'))].append(r['id'])
    return sorted(g.items(), key=lambda kv: -len(kv[1]))


def main():
    sys.stdout.reconfigure(encoding='utf-8')
    ap = argparse.ArgumentParser()
    ap.add_argument('--cases', type=int, default=200)
    ap.add_argument('--start', type=int, default=0)
    ap.add_argument('--procs', type=int, default=max(1, (os.cpu_count() or 4) - 2), help='Worker')
    ap.add_argument('--recycle', type=int, default=25, help='Fälle je Worker; 1 = jeder Fall frisch (reproduzierbar, für Vergleiche)')
    a = ap.parse_args()
    os.makedirs(OUT, exist_ok=True)
    port, t0 = serve(), time.time()
    results = run(port, a.start, a.cases, a.procs, t0, a.recycle)
    results.sort(key=lambda r: r['id'])
    with open(os.path.join(OUT, 'results.jsonl'), 'w', encoding='utf-8') as f:
        for r in results: f.write(json.dumps(r, ensure_ascii=False) + '\n')
    rej = sum(any(s.get('reject') for s in r.get('steps', [])) for r in results)
    fails = sum(r['fail'] for r in results)
    print(f'{len(results)} Fälle · {fails} mit Fehler ({100 * fails / max(1, len(results)):.1f} %) · {rej} abgelehnt (Radius zu groß) · {time.time() - t0:.0f}s')
    for (code, where, kind), ids in groups(results):
        print(f'{len(ids):5d}  {code:12s} {kind:8s} {where:28s} z. B. {", ".join(map(str, ids[:6]))}')


if __name__ == '__main__':
    main()
