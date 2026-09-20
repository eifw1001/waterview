#!/usr/bin/env python3
"""Register already-exported focus assets that predate selected-scenes.json."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "scripts" / "selected-scenes.json"
MODELS = ["wat3r", "da3", "watervggt", "watervggt_wcv"]


def main():
    data = json.loads(MANIFEST.read_text())
    if any(x["id"] == "creature_03" for x in data):
        return
    nf, count = 32, 8000
    data.append({
        "id": "creature_03", "group": "uveb", "nf": nf,
        "video": "raw/creature-03__ref.mp4",
        "img": "frames_img/uveb/creature_03/",
        "tags": "浑浊:medium 偏绿:medium 纹理:low 相机动:low 鱼动:low",
        "title": "背景细杆", "description": "重点案例：核对后方细杆的缺失、断裂或过滤影响",
        "badge": "重点案例 · 待确认几何差异",
        "focus": "watervggt",
        "focusCase": "rod",
        "focusFrame": 18,
        "focusNote": "先以 RGB 局部与四模型几何同帧对照；未把失败方法预写入标签。",
        "bins": {
            model: {"url": f"clouds_anim/creature_03_{model}.bin",
                    "counts": [count] * nf,
                    "offsets": [i * count * 16 for i in range(nf)]}
            for model in MODELS
        },
    })
    MANIFEST.write_text(json.dumps(data, ensure_ascii=False, indent=1) + "\n")
    print("registered creature_03")


if __name__ == "__main__":
    main()
