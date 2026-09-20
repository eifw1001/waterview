#!/usr/bin/env python3
"""Build the small, browser-friendly benchmark manifest used by WaterView.

The source of truth stays outside the website: eval_water3d/results/metrics.json
and common_frames.json.  This script only copies numbers and derived rankings;
it never runs an evaluation or changes model outputs.
"""
import json
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
DEPLOY = ROOT.parent
EVAL = DEPLOY / "eval_water3d"
DATA = DEPLOY.parent.parent / "data" / "water3D"
METRICS = json.loads((EVAL / "results/metrics.json").read_text())
COMMON = json.loads((EVAL / "common_frames.json").read_text())
SELECTED = json.loads((ROOT / "scripts/selected-scenes.json").read_text())
GALLERY_PATH = ROOT / "assets/gt_gallery.json"

MODELS = ["wat3r", "da3", "watervggt", "watervggt_wcv"]
MODEL_LABELS = {
    "wat3r": "Wat3R", "da3": "DA3", "watervggt": "VGGT",
    "watervggt_wcv": "WCV + VGGT",
}


def scene_key(scene):
    return scene.get("sid", scene["id"])


def original_frames(scene):
    folder = DATA / scene / "images"
    return len(list(folder.glob("*.jpg")))


def first_size(scene):
    folder = DATA / scene / "images"
    first = next(iter(sorted(folder.glob("*.jpg"))), None)
    if not first:
        return None
    with Image.open(first) as im:
        return [im.width, im.height]


def pred_size(model, scene):
    path = EVAL / "results" / model / scene / "pred.npz"
    if not path.exists():
        return None
    with np.load(path) as z:
        h, w = z["depth"].shape[1:]
    return [int(w), int(h)]


def ranking(family, key, higher=False):
    rows = []
    for model in MODELS:
        for scene, entry in METRICS.get(model, {}).items():
            value = entry.get(family, {}).get(key)
            if isinstance(value, (int, float)) and np.isfinite(value):
                rows.append({"model": model, "scene": scene, "value": value})
    return sorted(rows, key=lambda row: row["value"], reverse=higher)


def main():
    resource_scenes = {scene_key(s) for s in SELECTED}
    scene_stats = {}
    for scene, frames in COMMON.items():
        shape = None
        gt_path = EVAL / "gt" / f"{scene}.npz"
        if gt_path.exists():
            with np.load(gt_path, allow_pickle=True) as z:
                shape = [int(z["images_u8"].shape[2]), int(z["images_u8"].shape[1])]
        scene_stats[scene] = {
            "originalFrames": original_frames(scene),
            "evaluatedFrames": int(frames["n_frames"]),
            "gtResolution": shape,
            "sourceResolution": first_size(scene),
            "inputResolution": pred_size("watervggt", scene),
        }

    groups = {}
    for model in ["wat3r", "watervggt"]:
        groups[model] = {}
        for task, family, key in [
            ("depth", "depth", "abs_rel"),
            ("point", "point", "overall"),
        ]:
            rows = ranking(family, key)
            groups[model][task] = {
                "metric": key,
                "direction": "↓",
                "all": [r for r in rows if r["model"] == model],
                "available": [r for r in rows if r["model"] == model and r["scene"] in resource_scenes],
            }

    gallery = json.loads(GALLERY_PATH.read_text()) if GALLERY_PATH.exists() else []
    out = {
        "version": 2,
        "models": MODEL_LABELS,
        "metrics": METRICS,
        "commonFrames": COMMON,
        "sceneStats": scene_stats,
        "resourceScenes": sorted(resource_scenes),
        "rankings": groups,
        "gallery": gallery,
        "protocol": {
            "summary": "本地统一评测：同一 common_frames，深度逐视图 scale+shift 对齐，点云 Sim(3) 对齐到 GT；场景内对帧指标取平均。",
            "scope": "这是本地复现实验结果，不是论文原表；Wild 没有 GT 准确度分数。",
            "depth": "AbsRel/RMSE 等在 geometric GT valid_mask 上计算；网页的 Filtered GT 也使用该 geometric depth + valid_mask。",
            "point": "CD/Chamfer = point.overall，Acc/Comp 为双向距离，F-score 阈值为 GT 包围盒对角线的 2%。",
            "input": "原图尺寸、GT/评测尺寸和模型输入尺寸分别记录，不能互换。",
        },
    }
    target = ROOT / "assets/benchmark.js"
    target.write_text("window.WATERVIEW_BENCHMARK = " + json.dumps(out, ensure_ascii=False, separators=(",", ":")) + ";\n")
    print(f"wrote {target} ({target.stat().st_size / 1024:.1f} KiB)")


if __name__ == "__main__":
    main()
