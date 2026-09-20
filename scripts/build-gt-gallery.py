#!/usr/bin/env python3
"""Export a deliberately small gallery from geometric GT and its valid mask."""
import json
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
from matplotlib import colormaps
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
EVAL = ROOT.parent / "eval_water3d"
OUT = ROOT / "assets" / "gt_gallery"
PICKS = [
    ("cv_1000", 4, "远场与低纹理"), ("cv_1123", 11, "沙石纹理"),
    ("cv_1151", 20, "浑浊水底"), ("cv_1326", 6, "远场毛刺"),
    ("video_11634794", 10, "潜水员候选"), ("video_33847329", 16, "前景目标"),
    ("video_31596500", 24, "低分候选"), ("video_31824524", 7, "鱼群"),
    ("video_6430502", 14, "复杂背景"), ("video_7762649", 22, "GT 缺失候选"),
]


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    items = []
    for scene, frame, note in PICKS:
        with np.load(EVAL / "gt" / f"{scene}.npz", allow_pickle=True) as z:
            rgb = z["images_u8"][frame]
            depth = z["depth"][frame].astype(np.float32)
            valid = z["valid_mask"][frame].astype(bool)
            instance = str(z["instances"][frame])
            all_depth = z["depth"]
        finite = all_depth[np.isfinite(all_depth) & (all_depth > 0)]
        lo, hi = np.percentile(finite, [2, 98])
        normalized = np.clip((depth - lo) / max(hi - lo, 1e-6), 0, 1)
        rgba = (colormaps["turbo"](normalized)[..., :3] * 255).astype(np.uint8)
        rgba[~valid] = [28, 35, 45]
        rgb_name = f"{scene}_{frame:03d}_rgb.jpg"
        gt_name = f"{scene}_{frame:03d}_gt.png"
        Image.fromarray(rgb).save(OUT / rgb_name, quality=90)
        Image.fromarray(rgba).save(OUT / gt_name)
        items.append({
            "scene": scene, "frame": frame, "instance": instance,
            "note": note, "rgb": f"assets/gt_gallery/{rgb_name}",
            "gt": f"assets/gt_gallery/{gt_name}",
            "validCoverage": round(float(valid.mean()), 4),
            "scale": [round(float(lo), 4), round(float(hi), 4)],
            "label": "Filtered GT · geometric depth + valid_mask",
        })
    (ROOT / "assets" / "gt_gallery.json").write_text(json.dumps(items, ensure_ascii=False, indent=1))
    print(f"wrote {len(items)} gallery items to {OUT}")


if __name__ == "__main__":
    main()
