"""Split selected point clouds losslessly so first paint only needs one frame."""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
scenes = json.loads((ROOT / 'scripts/selected-scenes.json').read_text())
HD_ROOT = ROOT.parent / 'experiments' / 'dynamic_underwater' / 'website' / 'clouds_anim'
HD_INDEX = HD_ROOT / 'index.json'
HD_FOCUS = {'creature_03', 'creature_15'}
hd_index = json.loads(HD_INDEX.read_text()) if HD_INDEX.exists() else {}
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
        hd = hd_index.get(scene.get('sid', scene['id']), {}).get(model)
        hd_src = HD_ROOT / f"{scene.get('sid', scene['id'])}_{model}.bin"
        if scene.get('sid', scene['id']) in HD_FOCUS and hd and hd_src.exists():
            hd_folder = Path('clouds_hd') / scene.get('sid', scene['id']) / model
            (ROOT / hd_folder).mkdir(parents=True, exist_ok=True)
            for frame, (count, offset) in enumerate(zip(hd['counts'], hd['offsets'])):
                target = ROOT / hd_folder / f'{frame:03d}.bin'
                if not target.exists() or target.stat().st_size != count * 16:
                    with hd_src.open('rb') as src:
                        src.seek(offset)
                        target.write_bytes(src.read(count * 16))
            entry['bins'][model]['hdPath'] = str(hd_folder) + '/'
            entry['bins'][model]['hdCounts'] = hd['counts']
    manifest.append(entry)
(ROOT / 'assets/scenes.js').write_text(
    'window.WATERVIEW_SCENES = ' + json.dumps(manifest, ensure_ascii=False, separators=(',', ':')) + ';\n')
print(f'Built {len(manifest)} scenes, original float32 coordinates and colors preserved.')
