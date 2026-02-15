# FBX Exporter for Three.js

A binary FBX exporter for Three.js that exports scenes, meshes, and animations to the FBX 7500 format.

## Features

- Export Three.js scenes, objects, and groups to binary FBX format
- Support for skinned meshes and skeletal animations
- Material and texture export with optional image embedding
- Configurable export options (scale, visibility, texture size)
- Compatible with Blender, Maya, and other 3D applications

## Installation

Copy `examples/jsm/exporters/FBXExporter.js` to your project.

## Usage

```javascript
import { FBXExporter } from './path/to/FBXExporter.js';

const exporter = new FBXExporter();
const options = {
    exportSkin: true,
    exportMaterials: true,
    embedImages: true,
    maxTextureSize: 1024,
    scale: 1,
    animations: []
};

const blob = await exporter.parse(scene, options);
```

## Options

- `exportSkin` - Export skinned mesh data (default: true)
- `exportMaterials` - Export materials and textures (default: true)
- `onlyVisible` - Export only visible objects (default: true)
- `embedImages` - Embed textures in FBX file (default: true)
- `maxTextureSize` - Maximum texture resolution (default: 1024)
- `scale` - Scale factor for exported geometry (default: 1)
- `animations` - Array of AnimationClip objects to export

## Example

See `examples/misc_exporter_fbx.html` for a complete working example with a local server.

Run the example:
```bash
python server.py
```

Then open http://localhost:5000 in your browser.

## License

MIT License - See LICENSE file for details.

## Notes

This exporter was developed for a side project and open sourced for community use. It supports core FBX features but may not cover all edge cases. Contributions are welcome.
