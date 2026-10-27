"""Values at one grid cell: the map layers and each ensemble member.

Files are opened lazily and only the requested cell is read, so this stays
cheap for continental grids (an Africa-wide members file can be ~1 GB).
"""
from __future__ import annotations

import math
import threading
from collections import OrderedDict
from pathlib import Path

import numpy as np
import xarray as xr

_CACHE: "OrderedDict[str, xr.Dataset]" = OrderedDict()
_LOCK = threading.Lock()
_MAX_OPEN = 32
TERCILE_VARS = {"rain_p33": "p33", "rain_p66": "p66", "rain_prob_bn": "bn", "rain_prob_nn": "nn",
                "rain_prob_an": "an"}


def _open(path: Path) -> xr.Dataset:
    key = str(path)
    with _LOCK:
        if key in _CACHE:
            _CACHE.move_to_end(key)
            return _CACHE[key]
    ds = xr.open_dataset(path, decode_timedelta=False, cache=False)   # lazy: reads on access
    with _LOCK:
        _CACHE[key] = ds
        while len(_CACHE) > _MAX_OPEN:
            _CACHE.popitem(last=False)[1].close()
    return ds


def _num(v):
    v = float(v)
    return None if math.isnan(v) else round(v, 4)


def _cell(lat_vals: np.ndarray, lon_vals: np.ndarray, lat: float, lon: float):
    res_lat = abs(float(lat_vals[1] - lat_vals[0])) if lat_vals.size > 1 else 1.0
    res_lon = abs(float(lon_vals[1] - lon_vals[0])) if lon_vals.size > 1 else 1.0
    i, j = int(np.abs(lat_vals - lat).argmin()), int(np.abs(lon_vals - lon).argmin())
    if abs(lat_vals[i] - lat) > res_lat / 2 + 1e-9 or abs(lon_vals[j] - lon) > res_lon / 2 + 1e-9:
        return None
    return i, j


def point_values(layers_nc: Path, members_nc: Path | None, lat: float, lon: float) -> dict | None:
    lay = _open(layers_nc)
    la, lo = lay["lat"].values, lay["lon"].values
    cell = _cell(la, lo, lat, lon)
    if cell is None:
        return None
    i, j = cell
    out = {"lat": round(float(la[i]), 4), "lon": round(float(lo[j]), 4),
           "layers": {v: _num(lay[v].isel(lat=i, lon=j).values) for v in lay.data_vars
                      if set(lay[v].dims) == {"lat", "lon"}}}
    out["inside"] = any(v is not None for v in out["layers"].values())
    if members_nc is not None:
        mem = _open(members_nc)
        mi = int(np.abs(mem["lat"].values - out["lat"]).argmin())
        mj = int(np.abs(mem["lon"].values - out["lon"]).argmin())
        cell_ds = mem.isel(lat=mi, lon=mj)
        out["members"] = {v: [_num(x) for x in cell_ds[v].values]
                          for v in mem.data_vars if "member" in mem[v].dims}
        terc = {short: _num(cell_ds[v].values) for v, short in TERCILE_VARS.items() if v in mem}
        out["terciles"] = terc or None
    return out
