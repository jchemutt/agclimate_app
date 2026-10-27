"""Values at one grid cell: the map layers and each ensemble member."""
from __future__ import annotations

import math
import threading
from collections import OrderedDict
from pathlib import Path

import numpy as np
import xarray as xr

_CACHE: "OrderedDict[str, xr.Dataset]" = OrderedDict()
_LOCK = threading.Lock()
_MAX_OPEN = 16
TERCILE_VARS = {"rain_p33": "p33", "rain_p66": "p66", "rain_prob_bn": "bn", "rain_prob_nn": "nn",
                "rain_prob_an": "an"}


def _open(path: Path) -> xr.Dataset:
    key = str(path)
    with _LOCK:
        if key in _CACHE:
            _CACHE.move_to_end(key)
            return _CACHE[key]
    ds = xr.open_dataset(path, decode_timedelta=False).load()   # small: one run, 2-D maps
    with _LOCK:
        _CACHE[key] = ds
        while len(_CACHE) > _MAX_OPEN:
            _CACHE.popitem(last=False)
    return ds


def _num(v):
    v = float(v)
    return None if math.isnan(v) else round(v, 4)


def _cell(ds: xr.Dataset, lat: float, lon: float):
    la, lo = ds["lat"].values, ds["lon"].values
    res_lat = abs(float(la[1] - la[0])) if la.size > 1 else 1.0
    res_lon = abs(float(lo[1] - lo[0])) if lo.size > 1 else 1.0
    i, j = int(np.abs(la - lat).argmin()), int(np.abs(lo - lon).argmin())
    if abs(la[i] - lat) > res_lat / 2 + 1e-9 or abs(lo[j] - lon) > res_lon / 2 + 1e-9:
        return None
    return i, j


def point_values(layers_nc: Path, members_nc: Path | None, lat: float, lon: float) -> dict | None:
    lay = _open(layers_nc)
    cell = _cell(lay, lat, lon)
    if cell is None:
        return None
    i, j = cell
    out = {"lat": round(float(lay.lat.values[i]), 4), "lon": round(float(lay.lon.values[j]), 4),
           "layers": {v: _num(lay[v].values[i, j]) for v in lay.data_vars if lay[v].ndim == 2}}
    out["inside"] = any(v is not None for v in out["layers"].values())
    if members_nc is not None:
        mem = _open(members_nc)
        mi = int(np.abs(mem.lat.values - out["lat"]).argmin())
        mj = int(np.abs(mem.lon.values - out["lon"]).argmin())
        out["members"] = {v: [_num(x) for x in mem[v].values[:, mi, mj]]
                          for v in mem.data_vars if "member" in mem[v].dims}
        terc = {short: _num(mem[v].values[mi, mj]) for v, short in TERCILE_VARS.items() if v in mem}
        out["terciles"] = terc or None
    return out
