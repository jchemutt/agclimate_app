import json
import shutil
from pathlib import Path

import numpy as np
import pytest
import xarray as xr
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[2]


def _published(root: Path, cid="kenya", init="2026-10-01"):
    run = root / cid / init
    for d in ("layers", "areas", "data"):
        (run / d).mkdir(parents=True)
    (root / cid / "boundaries").mkdir(parents=True)
    lat, lon = np.array([0.0, 0.1]), np.array([36.0, 36.1, 36.2])
    adv = np.array([[0, 1, 2], [3, np.nan, 1]], float)
    rain = np.array([[100, 200, 300], [400, np.nan, 600]], float)
    xr.Dataset({"advisory_class": (("lat", "lon"), adv), "rainfall_total": (("lat", "lon"), rain)},
               coords={"lat": lat, "lon": lon}).to_netcdf(run / "data" / "layers.nc")
    rng = np.random.default_rng(0)
    xr.Dataset({"rainfall_total": (("member", "lat", "lon"), rng.uniform(50, 700, (4, 2, 3))),
                "rain_p33": (("lat", "lon"), np.full((2, 3), 250.0)),
                "rain_p66": (("lat", "lon"), np.full((2, 3), 450.0))},
               coords={"lat": lat, "lon": lon}).to_netcdf(run / "data" / "members.nc")
    for lid, typ in (("advisory_class", "categorical"), ("rainfall_total", "continuous"), ("spi_3", "continuous")):
        (run / "layers" / f"{lid}.tif").write_bytes(b"II*\x00fake")
        leg = {"id": lid, "type": typ, "title": lid}
        if typ == "categorical":
            leg["classes"] = [{"value": k, "label": n, "color": "#000"}
                              for k, n in enumerate(["Normal", "Watch", "Alert", "Emergency"])]
        else:
            leg["stops"] = [{"value": 0, "color": "#fff"}, {"value": 1, "color": "#000"}]
        (run / "layers" / f"{lid}.json").write_text(json.dumps(leg))
    catalog = {"domain": cid, "init": init, "valid_from": init, "valid_to": "2027-04-30", "members": 4,
               "bbox": [36.0, 0.0, 36.2, 0.1], "grid": {"resolution": 0.1, "nlat": 2, "nlon": 3},
               "layers": [{"id": l, "title": l.title(), "type": t, "units": "", "cog": f"layers/{l}.tif",
                           "legend": f"layers/{l}.json"} for l, t in
                          (("rainfall_total", "continuous"), ("advisory_class", "categorical"),
                           ("spi_3", "continuous"))],
               "areas": [{"level": "ward", "count": 1, "summary": "areas/ward.json"},
                         {"level": "county", "count": 1, "summary": "areas/county.json"}],
               "data": {"members": "data/members.nc", "layers": "data/layers.nc"}}
    (run / "catalog.json").write_text(json.dumps(catalog))
    (run / "areas" / "county.json").write_text(json.dumps({"level": "county", "layers": ["advisory_class", "rainfall_total"], "areas": [
        {"id": "nairobi", "name": "Nairobi", "parent_id": None,
         "values": {"advisory_class": {"majority": 2, "share": {"2": 1.0}}, "rainfall_total": {"mean": 321.5}}}]}))
    (run / "areas" / "ward.json").write_text(json.dumps({"level": "ward", "layers": ["advisory_class", "rainfall_total"], "areas": [
        {"id": "nairobi/westlands/parklands", "name": "Parklands", "parent_id": "nairobi",
         "values": {"advisory_class": {"majority": 3, "share": {"3": 1.0}}, "rainfall_total": {"mean": 120.0}}},
        {"id": "nairobi/westlands/kangemi", "name": "Kangemi", "parent_id": "nairobi",
         "values": {"advisory_class": {"majority": 0, "share": {"0": 1.0}}, "rainfall_total": {"mean": None}}}]}))
    (root / cid / "boundaries" / "county.geojson").write_text(json.dumps(
        {"type": "FeatureCollection", "features": []}))
    (root / cid / "runs.json").write_text(json.dumps({"domain": cid, "runs": [
        {"init": init, "catalog": f"{init}/catalog.json"}]}))
    (root / cid / "latest.json").write_text(json.dumps({"domain": cid, "init": init}))


@pytest.fixture
def client(tmp_path, monkeypatch):
    data, profiles = tmp_path / "published", tmp_path / "profiles"
    _published(data)
    shutil.copytree(ROOT / "profiles", profiles)
    monkeypatch.setenv("DATA_DIR", str(data))
    monkeypatch.setenv("PROFILES_DIR", str(profiles))
    from app.core.deps import reset_caches
    from app.main import create_app
    reset_caches()
    c = TestClient(create_app())
    c.profiles_dir = profiles
    return c


def test_template_profile_is_valid():
    import yaml
    from app.core.profiles import Profile
    p = Profile.model_validate(yaml.safe_load((ROOT / "profiles" / "_template.yaml").read_text()))
    assert p.season_for("2026-09-01")["id"] == "SOND"


def test_countries_list_with_latest_run(client):
    r = client.get("/api/v1/countries").json()
    assert [c["id"] for c in r] == ["kenya"]
    assert r[0]["latest"]["init"] == "2026-10-01"
    assert r[0]["latest"]["season"]["id"] == "OND"


def test_adding_a_country_needs_only_a_profile(client):
    import yaml
    tpl = yaml.safe_load((ROOT / "profiles" / "_template.yaml").read_text())
    (client.profiles_dir / "rwanda.yaml").write_text(yaml.safe_dump(tpl))
    r = {c["id"]: c for c in client.get("/api/v1/countries").json()}
    assert set(r) == {"kenya", "rwanda"} and r["rwanda"]["latest"] is None   # no run published yet
    assert client.get("/api/v1/countries/rwanda/runs/latest").status_code == 404
    (client.profiles_dir / "rwanda.yaml").write_text("id: Rwanda!\nname: x\n")  # invalid -> reported
    h = client.get("/api/v1/health").json()
    assert "rwanda.yaml" in h["invalid_profiles"] and h["countries"] == ["kenya"]


def test_run_view_merges_profile_and_catalog(client):
    r = client.get("/api/v1/countries/kenya/runs/latest")
    assert r.status_code == 200
    v = r.json()
    assert v["init"] == "2026-10-01" and v["season"]["label"]["sw"] == "Mvua za vuli"
    assert [g["id"] for g in v["groups"]] == ["advisory", "rainfall", "drought"]
    assert v["groups"][0]["layers"] == ["advisory_class"] and v["default_layer"] == "advisory_class"
    adv = v["layers"]["advisory_class"]
    assert adv["title"]["sw"] == "Ushauri wa msimu"
    assert adv["legend"]["classes"][3]["label"]["sw"] == "Dharura"
    assert adv["advisories"]["2"]["en"].startswith("Clearly worse")
    assert adv["cog_url"] == "/api/v1/files/kenya/2026-10-01/layers/advisory_class.tif"
    assert [a["level"] for a in v["areas"]] == ["county", "ward"]          # profile order
    assert v["areas"][0]["label"]["en"] == "County" and v["point_query"] is True


def test_point_query(client):
    p = client.get("/api/v1/countries/kenya/runs/latest/point", params={"lat": 0.02, "lon": 36.19}).json()
    assert (p["lat"], p["lon"]) == (0.0, 36.2)
    assert p["layers"] == {"advisory_class": 2.0, "rainfall_total": 300.0} and p["inside"]
    assert len(p["members"]["rainfall_total"]) == 4 and p["terciles"]["p33"] == 250.0
    sea = client.get("/api/v1/countries/kenya/runs/latest/point", params={"lat": 0.1, "lon": 36.1}).json()
    assert sea["inside"] is False
    assert client.get("/api/v1/countries/kenya/runs/latest/point", params={"lat": 3, "lon": 36}).status_code == 404


def test_files_and_areas(client):
    f = client.get("/api/v1/files/kenya/2026-10-01/layers/advisory_class.tif", headers={"Range": "bytes=0-3"})
    assert f.status_code == 206 and f.content == b"II*\x00"
    assert client.get("/api/v1/files/kenya/2026-10-01/data/layers.nc").status_code == 404     # not a layer file
    assert client.get("/api/v1/files/kenya/../secret.tif").status_code == 404
    assert client.get("/api/v1/files/other/2026-10-01/layers/x.tif").status_code == 404
    a = client.get("/api/v1/countries/kenya/runs/2026-10-01/areas/county")
    assert a.json()["areas"][0]["name"] == "Nairobi" and a.headers["cache-control"] == "public, max-age=300"   # dated but unversioned: may be republished
    assert client.get("/api/v1/countries/kenya/boundaries/county").status_code == 200
    assert client.get("/api/v1/countries/kenya/runs/2026-13-xx").status_code == 400
    assert client.get("/api/v1/countries/atlantis/runs/latest").status_code == 404


def test_area_outlook_for_integrations(client):
    o = client.get("/api/v1/countries/kenya/runs/latest/areas/ward/nairobi/westlands/parklands",
                   params={"lang": "sw"}).json()
    assert o["name"] == "Parklands" and o["parents"] == ["Nairobi"] and o["level_label"] == "Wadi"
    assert o["advisory"]["value"] == 3 and o["advisory"]["label"] == "Dharura"
    assert o["advisory"]["message"].startswith("Mojawapo ya misimu mibaya")
    rain = next(i for i in o["items"] if i["id"] == "rainfall_total")
    assert rain["value"] == 120.0 and rain["title"] == "Jumla ya mvua inayotarajiwa"
    en = client.get("/api/v1/countries/kenya/runs/latest/areas/county/nairobi", params={"lang": "xx"}).json()
    assert en["language"] == "en" and en["advisory"]["label"] == "Alert"          # unknown lang -> default
    assert client.get("/api/v1/countries/kenya/runs/latest/areas/ward/nowhere").status_code == 404


def test_area_search_and_csv(client):
    r = client.get("/api/v1/countries/kenya/runs/latest/areas/ward", params={"q": "PARK"}).json()
    assert [a["name"] for a in r["areas"]] == ["Parklands"]
    r = client.get("/api/v1/countries/kenya/runs/latest/areas/ward", params={"parent": "nairobi"}).json()
    assert len(r["areas"]) == 2
    c = client.get("/api/v1/countries/kenya/runs/2026-10-01/areas/ward", params={"format": "csv", "lang": "en"})
    assert c.headers["content-type"].startswith("text/csv") and "attachment" in c.headers["content-disposition"]
    rows = c.text.strip().splitlines()
    assert rows[0].startswith("id,name,parent_id,Seasonal advisory")
    assert rows[1].endswith("Emergency,120.0") and rows[2].endswith("Normal,")


def test_point_outlook_text(client):
    p = client.get("/api/v1/countries/kenya/runs/latest/point", params={"lat": 0.0, "lon": 36.2, "lang": "en"}).json()
    assert p["advisory"]["label"] == "Alert" and p["advisory"]["message"].startswith("Clearly worse")
    assert [i["id"] for i in p["items"]][0] == "advisory_class"


def test_openapi_documents_every_route(client):
    spec = client.get("/api/openapi.json").json()
    ops = [(path, m, op) for path, item in spec["paths"].items() for m, op in item.items()]
    assert all(path.startswith("/api/v1/") for path, _, _ in ops)
    ids = [op["operationId"] for _, _, op in ops]
    assert len(ids) == len(set(ids)) and "area_outlook" in ids and "point" in ids
    assert all(op.get("summary") and op.get("tags") for _, _, op in ops)
    assert "AreaOutlook" in spec["components"]["schemas"]
    assert client.get("/api/docs").status_code == 200


def test_dockerfile_healthcheck_uses_a_real_route(client):
    """The container health check must call an existing endpoint (it broke when routes moved to /api/v1)."""
    import re
    path = re.search(r"127\.0\.0\.1:8000(/[^'\"]+)", (ROOT / "api" / "Dockerfile").read_text()).group(1)
    assert client.get(path).status_code == 200


# ------------------------------------------------------------------ periods (prep v11)
DEMO = {k: Path(f"/tmp/claude-0/demo_{k}") for k in ("preview", "full")}


def _period_client(tmp_path, monkeypatch, which):
    if not (DEMO[which] / "kenya" / "latest.json").exists():
        pytest.skip(f"demo run {DEMO[which]} not built (bench/publish_demo3.py {which})")
    data = tmp_path / "data"
    shutil.copytree(DEMO[which], data)
    monkeypatch.setenv("DATA_DIR", str(data))
    monkeypatch.setenv("PROFILES_DIR", str(ROOT / "profiles"))
    from app.core.deps import reset_caches
    from app.main import create_app
    reset_caches()
    return TestClient(create_app())


@pytest.mark.parametrize("which", ["preview", "full"])
def test_run_view_periods(tmp_path, monkeypatch, which):
    c = _period_client(tmp_path, monkeypatch, which)
    v = c.get("/api/v1/countries/kenya/runs/latest").json()
    ids = [p["id"] for p in v["periods"]]
    assert ids[0] == "OND" and v["default_period"] == "OND" and "2026-11" in ids
    ond = next(p for p in v["periods"] if p["id"] == "OND")
    assert ond["kind"] == "season" and ond["label"]["en"]                    # label from the profile season
    assert v["preview"] is (which == "preview")
    assert v["index"]["heat_stress_days"]["OND"] == "heat_stress_days__OND"
    assert v["layers"]["heat_stress_days__OND"]["base"] == "heat_stress_days"
    menu = {b for g in v["groups"] for b in g["layers"]}
    assert "tmax_anomaly" in menu
    if which == "preview":
        assert "full" not in ids and "rainfall_total" not in menu
        assert v["default_layer"] in v["index"] and "OND" in v["index"][v["default_layer"]]
    else:
        assert ids[-1] == "full" and v["index"]["advisory_class"] == {"full": "advisory_class__full"}
        assert set(v["index"]["rainfall_total"]) >= {"OND", "2026-10", "full"}
    county = next(a for a in v["areas"] if a["level"] == "county")
    assert set(county["summary_urls"]) == set(ids)


def test_area_summaries_and_outlook_per_period(tmp_path, monkeypatch):
    c = _period_client(tmp_path, monkeypatch, "full")
    nov = c.get("/api/v1/countries/kenya/runs/latest/areas/county?period=2026-11").json()
    assert nov["period"] == "2026-11" and all("rainfall_total__2026-11" in a["values"] for a in nov["areas"])
    assert c.get("/api/v1/countries/kenya/runs/latest/areas/county?period=1999-01").status_code == 404
    dflt = c.get("/api/v1/countries/kenya/runs/latest/areas/county").json()
    assert dflt["period"] == "OND"
    aid = nov["areas"][0]["id"]
    o = c.get(f"/api/v1/countries/kenya/runs/latest/areas/county/{aid}?period=OND&lang=sw").json()
    assert o["period"] == "OND" and o["advisory"] is None                  # advisory is whole-forecast only
    assert {i["base"] for i in o["items"]} >= {"rainfall_total", "tmax_anomaly"}
    full = c.get(f"/api/v1/countries/kenya/runs/latest/areas/county/{aid}?period=full").json()
    assert full["advisory"] is not None
    csv = c.get("/api/v1/countries/kenya/runs/latest/areas/county?period=OND&format=csv")
    assert "_OND_county.csv" in csv.headers["content-disposition"]
    pt = c.get("/api/v1/countries/kenya/runs/latest/point?lat=0.5&lon=37.5&period=2026-12").json()
    assert pt["period"] == "2026-12" and all(i["period"] == "2026-12" for i in pt["items"])


def test_area_series(tmp_path, monkeypatch):
    c = _period_client(tmp_path, monkeypatch, "full")
    aid = c.get("/api/v1/countries/kenya/runs/latest/areas/county?period=2026-11").json()["areas"][0]["id"]
    r = c.get(f"/api/v1/countries/kenya/runs/latest/series/county/{aid}").json()
    assert [m["id"] for m in r["months"]] == ["2026-10", "2026-11", "2026-12", "2027-01", "2027-02", "2027-03", "2027-04"]
    assert len(r["series"]["rainfall_total"]) == 7 and all(v is not None for v in r["series"]["rainfall_total"])
    assert "onset_day" not in r["series"]                       # whole-forecast only
    assert c.get("/api/v1/countries/kenya/runs/latest/series/county/nowhere").status_code == 404


def test_republished_run_is_picked_up(tmp_path, monkeypatch):
    """A preview replaced by the full run for the same date (Oct 2026) must not be
    served from cache, and its file URLs must change so browsers refetch."""
    c = _period_client(tmp_path, monkeypatch, "preview")
    monkeypatch.setenv("INDEX_TTL", "0")
    from app.core.deps import reset_caches
    from app.main import create_app
    reset_caches()
    c = TestClient(create_app())
    v1 = c.get("/api/v1/countries/kenya/runs/latest").json()
    assert v1["preview"] is True and "?v=" in next(iter(v1["layers"].values()))["cog_url"]
    data = tmp_path / "data" / "kenya"
    # the full run lands in the same folder
    shutil.rmtree(data / "2026-10-01")
    shutil.copytree(DEMO["full"] / "kenya" / "2026-10-01", data / "2026-10-01")
    for f in ("runs.json", "latest.json"):
        shutil.copy(DEMO["full"] / "kenya" / f, data / f)
    import json as _j, time as _t
    for f, k in (("runs.json", None), ("latest.json", "updated")):
        d = _j.loads((data / f).read_text())
        if k: d[k] = "2026-10-29T03:04:23+00:00"
        else: d["runs"][0]["created"] = "2026-10-29T03:04:23+00:00"
        (data / f).write_text(_j.dumps(d))
    cat = _j.loads((data / "2026-10-01" / "catalog.json").read_text())
    cat["created"] = "2026-10-29T03:04:23+00:00"
    (data / "2026-10-01" / "catalog.json").write_text(_j.dumps(cat))
    _t.sleep(0.01)
    v2 = c.get("/api/v1/countries/kenya/runs/latest").json()
    assert v2["preview"] is False and "rainfall_total" in v2["index"]
    assert v2["version"] != v1["version"]
    url = v2["areas"][0]["summary_urls"]["OND"]
    r = c.get(url)
    assert r.headers["cache-control"].endswith("immutable")
    assert any(k.startswith("rainfall_total__OND") for k in r.json()["areas"][0]["values"])
    unversioned = c.get("/api/v1/countries/kenya/runs/2026-10-01/areas/county?period=OND")
    assert "immutable" not in unversioned.headers["cache-control"]
