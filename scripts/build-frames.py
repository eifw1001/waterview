"""Split selected point clouds losslessly so first paint only needs one frame."""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
scenes = json.loads((ROOT / 'scripts/selected-scenes.json').read_text())
manifest = []
for scene in scenes:
    entry = {k: v for k, v in scene.items() if k != 'bins'}
    entry['bins'] = {}
    for model, meta in scene['bins'].items():
        data = (ROOT / meta['url']).read_bytes()
        version = hashlib.sha256(data).hexdigest()[:12]
        folder = Path('clouds_frames') / scene['id'] / (model + '-' + version)
        (ROOT / folder).mkdir(parents=True, exist_ok=True)
        assert len(meta['counts']) == scene['nf'] == len(meta['offsets'])
        for frame, (count, offset) in enumerate(zip(meta['counts'], meta['offsets'])):
            chunk = data[offset:offset + count * 16]
            assert len(chunk) == count * 16
            (ROOT / folder / f'{frame:03d}.bin').write_bytes(chunk)
        entry['bins'][model] = {'path': str(folder) + '/', 'counts': meta['counts']}
    manifest.append(entry)
(ROOT / 'assets/scenes.js').write_text(
    'window.WATERVIEW_SCENES = ' + json.dumps(manifest, ensure_ascii=False, separators=(',', ':')) + ';\n')
print(f'Built {len(manifest)} scenes, original float32 coordinates and colors preserved.')
