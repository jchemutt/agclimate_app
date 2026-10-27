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
    (run / "areas" / "county.json").write_text(json.dumps({"level": "county", "areas": [
        {"id": "nairobi", "name": "Nairobi", "values": {"advisory_class": {"majority": 2}}}]}))
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
    import app.main as m
    m._store.cache_clear()
    m._registry.cache_clear()
    c = TestClient(m.create_app())
    c.profiles_dir = profiles
    return c


def test_template_profile_is_valid():
    import yaml
    from app.profiles import Profile
    p = Profile.model_validate(yaml.safe_load((ROOT / "profiles" / "_template.yaml").read_text()))
    assert p.season_for("2026-09-01")["id"] == "SOND"


def test_countries_list_with_latest_run(client):
    r = client.get("/api/countries").json()
    assert [c["id"] for c in r] == ["kenya"]
    assert r[0]["latest"]["init"] == "2026-10-01"
    assert r[0]["latest"]["season"]["id"] == "OND"


def test_adding_a_country_needs_only_a_profile(client):
    import yaml
    tpl = yaml.safe_load((ROOT / "profiles" / "_template.yaml").read_text())
    (client.profiles_dir / "rwanda.yaml").write_text(yaml.safe_dump(tpl))
    r = {c["id"]: c for c in client.get("/api/countries").json()}
    assert set(r) == {"kenya", "rwanda"} and r["rwanda"]["latest"] is None   # no run published yet
    assert client.get("/api/countries/rwanda/runs/latest").status_code == 404
    (client.profiles_dir / "rwanda.yaml").write_text("id: Rwanda!\nname: x\n")  # invalid -> reported
    h = client.get("/api/health").json()
    assert "rwanda.yaml" in h["invalid_profiles"] and h["countries"] == ["kenya"]


def test_run_view_merges_profile_and_catalog(client):
    r = client.get("/api/countries/kenya/runs/latest")
    assert r.status_code == 200
    v = r.json()
    assert v["init"] == "2026-10-01" and v["season"]["label"]["sw"] == "Mvua za vuli"
    assert [g["id"] for g in v["groups"]] == ["advisory", "rainfall", "drought"]
    assert v["groups"][0]["layers"] == ["advisory_class"] and v["default_layer"] == "advisory_class"
    adv = v["layers"]["advisory_class"]
    assert adv["title"]["sw"] == "Ushauri wa msimu"
    assert adv["legend"]["classes"][3]["label"]["sw"] == "Dharura"
    assert adv["advisories"]["2"]["en"].startswith("Clearly worse")
    assert adv["cog_url"] == "/api/files/kenya/2026-10-01/layers/advisory_class.tif"
    assert [a["level"] for a in v["areas"]] == ["county", "ward"]          # profile order
    assert v["areas"][0]["label"]["en"] == "County" and v["point_query"] is True


def test_point_query(client):
    p = client.get("/api/countries/kenya/runs/latest/point", params={"lat": 0.02, "lon": 36.19}).json()
    assert (p["lat"], p["lon"]) == (0.0, 36.2)
    assert p["layers"] == {"advisory_class": 2.0, "rainfall_total": 300.0} and p["inside"]
    assert len(p["members"]["rainfall_total"]) == 4 and p["terciles"]["p33"] == 250.0
    sea = client.get("/api/countries/kenya/runs/latest/point", params={"lat": 0.1, "lon": 36.1}).json()
    assert sea["inside"] is False
    assert client.get("/api/countries/kenya/runs/latest/point", params={"lat": 3, "lon": 36}).status_code == 404


def test_files_and_areas(client):
    f = client.get("/api/files/kenya/2026-10-01/layers/advisory_class.tif", headers={"Range": "bytes=0-3"})
    assert f.status_code == 206 and f.content == b"II*\x00"
    assert client.get("/api/files/kenya/2026-10-01/data/layers.nc").status_code == 404     # not a layer file
    assert client.get("/api/files/kenya/../secret.tif").status_code == 404
    assert client.get("/api/files/other/2026-10-01/layers/x.tif").status_code == 404
    a = client.get("/api/countries/kenya/runs/2026-10-01/areas/county")
    assert a.json()["areas"][0]["name"] == "Nairobi" and "immutable" in a.headers["cache-control"]
    assert client.get("/api/countries/kenya/boundaries/county").status_code == 200
    assert client.get("/api/countries/kenya/runs/2026-13-xx").status_code == 400
    assert client.get("/api/countries/atlantis/runs/latest").status_code == 404
