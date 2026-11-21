"""
Builds server/data/players.json — every player who has appeared in an IPL match.

Sources (all open data, nothing invented):
  * Cricsheet ball-by-ball IPL archive  -> identity, teams, seasons, appearances, career stats
  * Cricsheet people register           -> ESPNcricinfo id used as a join key
  * Wikidata                            -> full name, country, date of birth, Commons photo
  * English Wikipedia cricketer infobox -> batting style, bowling style, playing role

Fields that no open source provides (e.g. historical auction base price) are left null.
Usage:  python scripts/build_players.py     (run from the server/ directory)
"""
import csv, io, json, re, sys, time, zipfile, urllib.parse, urllib.request
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
OUT = ROOT / "data" / "players.json"
UA = "auction-arena-data-builder/1.0"

TEAM_MAP = {
    "Chennai Super Kings": "CSK", "Mumbai Indians": "MI",
    "Royal Challengers Bangalore": "RCB", "Royal Challengers Bengaluru": "RCB",
    "Kolkata Knight Riders": "KKR", "Rajasthan Royals": "RR", "Sunrisers Hyderabad": "SRH",
    "Delhi Capitals": "DC", "Delhi Daredevils": "DC", "Punjab Kings": "PBKS", "Kings XI Punjab": "PBKS",
    "Gujarat Titans": "GT", "Lucknow Super Giants": "LSG",
    "Deccan Chargers": "DCH", "Gujarat Lions": "GL", "Pune Warriors": "PWI",
    "Rising Pune Supergiant": "RPS", "Rising Pune Supergiants": "RPS", "Kochi Tuskers Kerala": "KTK",
}


def fetch(url, data=None, headers=None, tries=4):
    h = {"User-Agent": UA}
    h.update(headers or {})
    for i in range(tries):
        try:
            req = urllib.request.Request(url, data=data, headers=h)
            with urllib.request.urlopen(req, timeout=90) as r:
                return r.read()
        except Exception as e:  # noqa
            print("  retry", i + 1, str(e)[:100], file=sys.stderr)
            time.sleep(3 * (i + 1))
    return None


def download_raw():
    RAW.mkdir(parents=True, exist_ok=True)
    for name, url in (("ipl_json.zip", "https://cricsheet.org/downloads/ipl_json.zip"),
                      ("people.csv", "https://cricsheet.org/register/people.csv")):
        p = RAW / name
        if not p.exists():
            print("downloading", url)
            p.write_bytes(fetch(url))


def parse_matches():
    P = {}

    def get(pid, name):
        if pid not in P:
            P[pid] = dict(id=pid, name=name, matches=0, seasons=set(), teams=defaultdict(int),
                          runs=0, balls=0, outs=0, hs=0, fours=0, sixes=0, wkts=0, bballs=0, bruns=0,
                          stumpings=0, catches=0, pos=[], last=0)
        return P[pid]

    z = zipfile.ZipFile(RAW / "ipl_json.zip")
    n = 0
    for fn in z.namelist():
        if not fn.endswith(".json"):
            continue
        m = json.loads(z.read(fn))
        info = m["info"]
        reg = info.get("registry", {}).get("people", {})
        year = int(info["dates"][0][:4])
        n += 1
        for team, names in info.get("players", {}).items():
            code = TEAM_MAP.get(team, team)
            for nm in names:
                pid = reg.get(nm)
                if not pid:
                    continue
                p = get(pid, nm)
                p["matches"] += 1
                p["seasons"].add(year)
                p["teams"][code] += 1
                p["last"] = max(p["last"], year)
        for inn in m.get("innings", []):
            if inn.get("super_over"):
                continue
            order, score = [], defaultdict(int)
            for ov in inn.get("overs", []):
                for d in ov["deliveries"]:
                    ex = d.get("extras", {})
                    for who in (d["batter"], d.get("non_striker")):
                        if who and who not in order:
                            order.append(who)
                    bid, wid = reg.get(d["batter"]), reg.get(d["bowler"])
                    if bid:
                        b = get(bid, d["batter"])
                        r = d["runs"]["batter"]
                        b["runs"] += r
                        score[bid] += r
                        if "wides" not in ex:
                            b["balls"] += 1
                        if r == 4 and not d["runs"].get("non_boundary"):
                            b["fours"] += 1
                        if r == 6 and not d["runs"].get("non_boundary"):
                            b["sixes"] += 1
                    if wid:
                        w = get(wid, d["bowler"])
                        if "wides" not in ex and "noballs" not in ex:
                            w["bballs"] += 1
                        w["bruns"] += d["runs"]["total"] - ex.get("byes", 0) - ex.get("legbyes", 0) - ex.get("penalty", 0)
                    for wk in d.get("wickets", []):
                        oid = reg.get(wk["player_out"])
                        kind = wk["kind"]
                        if oid and kind not in ("retired hurt", "retired not out"):
                            get(oid, wk["player_out"])["outs"] += 1
                        if wid and kind not in ("run out", "retired hurt", "retired out", "retired not out", "obstructing the field"):
                            get(wid, d["bowler"])["wkts"] += 1
                        for f in wk.get("fielders", []):
                            fid = reg.get(f.get("name", ""))
                            if fid:
                                if kind == "stumped":
                                    get(fid, f["name"])["stumpings"] += 1
                                elif kind == "caught":
                                    get(fid, f["name"])["catches"] += 1
            for i, nm in enumerate(order):
                pid = reg.get(nm)
                if pid:
                    get(pid, nm)["pos"].append(i + 1)
            for pid, s in score.items():
                P[pid]["hs"] = max(P[pid]["hs"], s)
    print("matches parsed:", n, "players:", len(P))
    return P


def load_cricinfo_ids():
    ids = {}
    with open(RAW / "people.csv", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            if row.get("key_cricinfo"):
                ids[row["identifier"]] = row["key_cricinfo"]
    return ids


def cached(name, fn, keys):
    """Cache remote lookups in data/raw so re-runs only fetch what is missing."""
    path = RAW / name
    store = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    missing = [k for k in set(keys) if k not in store]
    if missing:
        store.update(fn(missing))
        path.write_text(json.dumps(store, ensure_ascii=False), encoding="utf-8")
    return store


def wikidata(cric_ids):
    out = {}
    ids = sorted(set(cric_ids))
    for i in range(0, len(ids), 150):
        chunk = ids[i:i + 150]
        q = """SELECT ?id ?p ?pLabel ?citLabel ?sportLabel ?img ?dob ?title WHERE {
  VALUES ?id { %s } ?p wdt:P2697 ?id.
  OPTIONAL { ?p wdt:P27 ?cit. } OPTIONAL { ?p wdt:P1532 ?sport. }
  OPTIONAL { ?p wdt:P18 ?img. } OPTIONAL { ?p wdt:P569 ?dob. }
  OPTIONAL { ?a schema:about ?p; schema:isPartOf <https://en.wikipedia.org/>; schema:name ?title. }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". } }""" % " ".join('"%s"' % x for x in chunk)
        raw = fetch("https://query.wikidata.org/sparql", data=urllib.parse.urlencode({"query": q}).encode(),
                    headers={"Accept": "application/sparql-results+json"})
        if not raw:
            continue
        for b in json.loads(raw)["results"]["bindings"]:
            v = lambda k: b[k]["value"] if k in b else None  # noqa
            d = out.setdefault(v("id"), {})
            for k, src in (("qid", "p"), ("label", "pLabel"), ("citizen", "citLabel"), ("sport", "sportLabel"),
                           ("img", "img"), ("dob", "dob"), ("title", "title")):
                if not d.get(k) and v(src):
                    d[k] = v(src)
        print("  wikidata", min(i + 150, len(ids)), "/", len(ids))
        time.sleep(1)
    return out


def clean_wiki(v):
    v = re.sub(r"<!--.*?-->", "", v, flags=re.S)
    v = re.sub(r"<ref[^>]*?/>", "", v)
    v = re.sub(r"<ref.*?</ref>", "", v, flags=re.S)
    v = re.sub(r"<br\s*/?>", ", ", v)
    v = re.sub(r"\{\{(?:nowrap|nobr|small)\|([^{}]*)\}\}", r"\1", v)
    v = re.sub(r"\{\{[^{}]*\}\}", "", v)
    v = re.sub(r"\[\[(?:[^\]|]*\|)?([^\]]*)\]\]", r"\1", v)
    v = re.sub(r"<[^>]+>", "", v).replace("'''", "").replace("''", "").replace("&nbsp;", " ")
    return re.sub(r"\s+", " ", v).strip(" ,;")


def infobox_fields(text):
    f = {}
    for key in ("batting", "bowling", "role", "country", "fullname", "full_name"):
        m = re.search(r"^\s*\|\s*%s\s*=(.*)$" % key, text, flags=re.M | re.I)
        if m:
            val = clean_wiki(m.group(1))
            if val:
                f[key] = val[:80]
    return f


def wikipedia(titles):
    out = {}
    titles = sorted(set(titles))
    for i in range(0, len(titles), 40):
        chunk = titles[i:i + 40]
        url = "https://en.wikipedia.org/w/api.php?" + urllib.parse.urlencode({
            "action": "query", "prop": "revisions", "rvprop": "content", "rvslots": "main", "rvsection": "0",
            "redirects": "1", "format": "json", "formatversion": "2", "titles": "|".join(chunk)})
        raw = fetch(url)
        if not raw:
            continue
        j = json.loads(raw)["query"]
        back = {}
        for n in j.get("normalized", []) + j.get("redirects", []):
            back[n["to"]] = back.get(n["from"], n["from"])
        for pg in j.get("pages", []):
            if "revisions" not in pg:
                continue
            txt = pg["revisions"][0]["slots"]["main"]["content"]
            out[back.get(pg["title"], pg["title"])] = infobox_fields(txt)
        print("  wikipedia", min(i + 40, len(titles)), "/", len(titles))
        time.sleep(1.5)
    return out


COUNTRY_FIX = {"United Kingdom": "England", "Dominion of India": "India", "British Raj": "India",
               "West Indies cricket team": "West Indies", "Kingdom of the Netherlands": "Netherlands"}
WI = {"Jamaica", "Trinidad and Tobago", "Barbados", "Guyana", "Saint Lucia", "Antigua and Barbuda", "Grenada",
      "Saint Vincent and the Grenadines", "Dominica", "Saint Kitts and Nevis", "Sint Maarten", "Montserrat", "Anguilla"}
KNOWN = ["India", "Australia", "South Africa", "New Zealand", "England", "West Indies", "Sri Lanka", "Pakistan",
         "Bangladesh", "Afghanistan", "Zimbabwe", "Ireland", "Netherlands", "Nepal", "Namibia", "Scotland",
         "United Arab Emirates", "United States", "Kenya", "Singapore", "Oman", "Canada", "Hong Kong"]


def norm_country(*cands):
    for c in cands:
        if not c:
            continue
        c = COUNTRY_FIX.get(c, c)
        if c in WI:
            return "West Indies"
        for k in KNOWN:
            if re.search(r"\b%s\b" % k, c):
                return k
    return None


def bowl_type(s):
    if not s:
        return None
    t = s.lower()
    if "unorthodox" in t or "chinaman" in t or "left-arm wrist" in t:
        return "Left-arm wrist spin"
    if "orthodox" in t:
        return "Left-arm orthodox"
    if "leg" in t and ("break" in t or "spin" in t) or "googly" in t:
        return "Leg spin"
    if "off" in t and ("break" in t or "spin" in t):
        return "Off spin"
    if "fast-medium" in t or "fast medium" in t:
        return "Fast-medium"
    if "medium-fast" in t or "medium fast" in t:
        return "Medium-fast"
    if "fast" in t:
        return "Fast"
    if "medium" in t:
        return "Medium"
    if "slow" in t or "spin" in t:
        return "Spin"
    return None


def classify(p, wrole):
    """Primary role: from the Wikipedia infobox when present, otherwise derived from match records."""
    r = (wrole or "").lower()
    src = "wikipedia"
    if "keeper" in r or "wicket" in r:
        role = "WK"
    elif "all" in r and "round" in r:
        role = "AR"
    elif "bowl" in r:
        role = "BOWL"
    elif "bat" in r or "opener" in r:
        role = "BAT"
    else:
        src = "derived"
        faced, bowled = p["balls"], p["bballs"]
        if p["stumpings"] > 0 and bowled < 30:
            role = "WK"
        elif bowled >= 60 and faced >= 60 and 0.35 <= bowled / max(1, faced) <= 3.5:
            role = "AR"
        elif bowled > faced:
            role = "BOWL"
        else:
            role = "BAT"
    sec = None
    if role == "AR":
        sec = "Batting all-rounder" if "bat" in r else "Bowling all-rounder" if "bowl" in r else None
    elif role == "WK":
        sec = "Batter"
    elif role == "BAT" and p["bballs"] >= 120:
        sec = "Part-time bowler"
    return role, sec, src


def bat_position(p):
    if len(p["pos"]) < 5 or p["balls"] < 60:
        return None
    avg = sum(p["pos"]) / len(p["pos"])
    return "Opener" if avg <= 2.3 else "Top order" if avg <= 4.2 else "Middle order" if avg <= 6.2 else "Finisher"


def base_price(matches):
    # Arena base price (lakhs). A transparent rule on IPL appearances — NOT a historical auction price.
    for m, pr in ((150, 200), (100, 150), (60, 100), (30, 75), (15, 50), (5, 40)):
        if matches >= m:
            return pr
    return 30


def main():
    download_raw()
    P = parse_matches()
    latest = max(p["last"] for p in P.values())
    cric = load_cricinfo_ids()
    wd = cached("wikidata_cache.json", wikidata, [cric[i] for i in P if i in cric])
    wp = cached("wikipedia_cache.json", wikipedia, [d["title"] for d in wd.values() if d.get("title")])
    ov = json.loads((ROOT / "data" / "overrides.json").read_text(encoding="utf-8"))
    players = []
    for pid, p in P.items():
        d = wd.get(cric.get(pid, ""), {})
        w = wp.get(d.get("title", ""), {}) if d.get("title") else {}
        nat = norm_country(w.get("country"), d.get("sport"), d.get("citizen"))
        nat_src = "wikipedia/wikidata"
        if not nat:
            nat = ov["nationality"].get(p["name"]) or ov["defaultUnmatchedNationality"]
            nat_src = "manual"
        label = d.get("label")
        if not label or re.fullmatch(r"Q\d+", label):
            label = re.sub(r"\s*\(.*\)$", "", d.get("title") or "") or p["name"]
        role, sec, role_src = classify(p, w.get("role"))
        bowling = w.get("bowling")
        img = d.get("img")
        if img:
            img = img.replace("http://", "https://") + "?width=400"
        teams = [t for t, _ in sorted(p["teams"].items(), key=lambda x: -x[1])]
        players.append({
            "id": pid, "name": label, "shortName": p["name"],
            "fullName": w.get("fullname") or w.get("full_name"),
            "nationality": nat, "nationalitySource": nat_src, "overseas": bool(nat and nat != "India"),
            "role": role, "secondaryRole": sec, "roleSource": role_src,
            "battingStyle": w.get("batting"), "bowlingStyle": bowling, "bowlingType": bowl_type(bowling),
            "battingPosition": bat_position(p),
            "teams": teams, "seasons": sorted(p["seasons"]), "matches": p["matches"],
            "active": p["last"] >= latest, "lastSeason": p["last"],
            "stats": {"runs": p["runs"], "balls": p["balls"], "outs": p["outs"], "highScore": p["hs"],
                      "fours": p["fours"], "sixes": p["sixes"], "wickets": p["wkts"], "ballsBowled": p["bballs"],
                      "runsConceded": p["bruns"], "catches": p["catches"], "stumpings": p["stumpings"]},
            "basePrice": base_price(p["matches"]), "historicalBasePrice": None,
            "photo": img, "dob": (d.get("dob") or "")[:10] or None,
            "wikipedia": d.get("title"), "cricinfoId": cric.get(pid),
        })
    players.sort(key=lambda x: (-x["matches"], x["name"]))
    OUT.write_text(json.dumps({"generatedFrom": ["cricsheet.org", "wikidata.org", "en.wikipedia.org"],
                               "latestSeason": latest, "players": players}, ensure_ascii=False), encoding="utf-8")
    n = len(players)
    c = lambda k: sum(1 for x in players if x.get(k))  # noqa
    print(f"wrote {n} players | nationality {c('nationality')} | batting {c('battingStyle')} | bowling {c('bowlingStyle')} "
          f"| photo {c('photo')} | wikipedia {c('wikipedia')} | latest season {latest}")


if __name__ == "__main__":
    main()
