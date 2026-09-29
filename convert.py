import bpy, sys
argv = sys.argv[sys.argv.index("--")+1:]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=argv[0])
bpy.ops.export_scene.gltf(filepath=argv[1], export_format='GLB', export_yup=True)
print("DONE:", argv[1])
