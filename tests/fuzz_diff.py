"""Vergleicht zwei Fuzz-Läufe (results.jsonl): welche Fälle besser bzw. schlechter wurden.

  python tests/fuzz_diff.py vorher.jsonl nachher.jsonl
"""
import json, sys


def load(p):
    out = {}
    for line in open(p, encoding='utf-8'):
        r = json.loads(line)
        out[r['id']] = {(c, (s.get('sig') or {}).get(c, '-'), s.get('kind', '-')) for s in r.get('steps', []) for c in (s.get('codes') or {})}
    return out


def main():
    sys.stdout.reconfigure(encoding='utf-8')
    a, b = load(sys.argv[1]), load(sys.argv[2])
    ids = sorted(set(a) & set(b))
    fixed = [i for i in ids if a[i] and not b[i]]
    broke = [i for i in ids if b[i] and not a[i]]
    changed = [i for i in ids if a[i] and b[i] and a[i] != b[i]]
    print(f'{len(ids)} gemeinsame Fälle · behoben {len(fixed)} · neu fehlerhaft {len(broke)} · anders fehlerhaft {len(changed)}')
    print('neu fehlerhaft:', ', '.join(f'{i} {sorted(b[i])}' for i in broke[:15]))
    print('anders:', '\n  '.join(f'{i}: {sorted(a[i])} -> {sorted(b[i])}' for i in changed[:15]))


if __name__ == '__main__':
    main()
