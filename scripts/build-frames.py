"""Split selected point clouds losslessly so first paint only needs one frame."""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
scenes = json.loads((ROOT / 'scripts/selected-scenes.json').read_text())
HD_ROOT = ROOT.parent / 'experiments' / 'dynamic_underwater' / 'website' / 'clouds_anim'
HD_INDEX = HD_ROOT / 'index.json'
hd_index = json.loads(HD_INDEX.read_text()) if HD_INDEX.exists() else {}
WATER3D_INDEX = HD_ROOT / 'index_multi.json'
water3d_index = json.loads(WATER3D_INDEX.read_text()).get('water3d', {}) if WATER3D_INDEX.exists() else {}
manifest = []
for scene in scenes:
    entry = {k: v for k, v in scene.items() if k != 'bins'}
    entry['bins'] = {}
    for model, meta in scene['bins'].items():
        data = (ROOT / meta['url']).read_bytes()
        version = hashlib.sha256(data).hexdigest()[:12]
        # Scenes appearing in several groups share one frames folder (same bin data).
        folder = Path('clouds_frames') / scene.get('sid', scene['id']) / (model + '-' + version)
        (ROOT / folder).mkdir(parents=True, exist_ok=True)
        assert len(meta['counts']) == scene['nf'] == len(meta['offsets'])
        for frame, (count, offset) in enumerate(zip(meta['counts'], meta['offsets'])):
            chunk = data[offset:offset + count * 16]
            assert len(chunk) == count * 16
            (ROOT / folder / f'{frame:03d}.bin').write_bytes(chunk)
        entry['bins'][model] = {'path': str(folder) + '/', 'counts': meta['counts']}
        sid = scene.get('sid', scene['id'])
        water3d = scene['group'] != 'uveb'
        hd = (water3d_index if water3d else hd_index).get(sid, {}).get(model)
        hd_src = HD_ROOT / ('water3d' if water3d else '') / f'{sid}_{model}.bin'
        # 使用已有的真实导出：Wild 20k，Water3D 12k。剪片头场景按源帧偏移。
        if hd and hd_src.exists():
            start = scene.get('sourceFrameOffset', 0)
            if len(hd['counts']) < start + scene['nf']:
                raise ValueError(f'{sid}/{model}: 高清源帧数不足')
            hd_folder = Path('clouds_hd') / sid / model
            (ROOT / hd_folder).mkdir(parents=True, exist_ok=True)
            counts = hd['counts'][start:start + scene['nf']]
            offsets = hd['offsets'][start:start + scene['nf']]
            for frame, (count, offset) in enumerate(zip(counts, offsets)):
                target = ROOT / hd_folder / f'{frame:03d}.bin'
                if not target.exists() or target.stat().st_size != count * 16:
                    with hd_src.open('rb') as src:
                        src.seek(offset)
                        chunk = src.read(count * 16)
                    if len(chunk) != count * 16:
                        raise ValueError(f'{sid}/{model}/{frame}: 高清源文件不完整')
                    target.write_bytes(chunk)
            entry['bins'][model]['hdPath'] = str(hd_folder) + '/'
            entry['bins'][model]['hdCounts'] = counts
    manifest.append(entry)
(ROOT / 'assets/scenes.js').write_text(
    'window.WATERVIEW_SCENES = ' + json.dumps(manifest, ensure_ascii=False, separators=(',', ':')) + ';\n')
print(f'Built {len(manifest)} scenes, original float32 coordinates and colors preserved.')
