#!/usr/bin/env python3
"""Export depth comparisons for the existing GT gallery; no model inference."""
import json
from pathlib import Path
import cv2
import numpy as np
from PIL import Image
from matplotlib import colormaps

ROOT = Path(__file__).resolve().parents[1]
EVAL = ROOT.parent / 'eval_water3d'
MODELS = ['wat3r', 'da3', 'watervggt', 'watervggt_wcv']


def main():
    out = ROOT / 'assets/depth'
    out.mkdir(exist_ok=True)
    items = json.loads((ROOT / 'assets/gt_gallery.json').read_text())
    for item in items:
        sid, frame = item['scene'], item['frame']
        with np.load(EVAL / 'gt' / (sid + '.npz'), allow_pickle=True) as gt:
            depth = gt['depth'][frame]
            valid = gt['valid_mask'][frame].astype(bool)
        lo, hi = item['scale']
        item['predictions'] = {}
        for model in MODELS:
            with np.load(EVAL / 'results' / model / sid / 'pred.npz') as z:
                dp = cv2.resize(z['depth'][frame], (depth.shape[1], depth.shape[0]), interpolation=cv2.INTER_NEAREST)
            mask = valid & np.isfinite(dp) & (dp > 1e-6)
            if mask.sum() < 100:
                continue
            # Same least-squares scale + shift as eval_water3d/depth_metrics.
            x = dp[mask].reshape(-1, 1)
            scale, shift = np.linalg.lstsq(np.concatenate([x, np.ones_like(x)], axis=1), depth[mask].reshape(-1, 1), rcond=None)[0].ravel()
            aligned = dp * scale + shift
            normalized = np.clip((aligned - lo) / max(hi - lo, 1e-6), 0, 1)
            rgb = (colormaps['turbo'](normalized)[..., :3] * 255).astype(np.uint8)
            rgb[~np.isfinite(aligned) | (aligned <= 1e-6)] = [28, 35, 45]
            name = f'{sid}_{frame:03d}_{model}.png'
            Image.fromarray(rgb).save(out / name)
            item['predictions'][model] = 'assets/depth/' + name
        print(sid, flush=True)
    (ROOT / 'assets/depth.js').write_text('window.WATERVIEW_DEPTH = ' + json.dumps(items, ensure_ascii=False) + ';\n')


if __name__ == '__main__':
    main()
