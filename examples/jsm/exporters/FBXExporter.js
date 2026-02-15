// V0.1 By github.com/Shoozes/
// shoozes@shoozes.com

import * as THREE from 'three';

/**
 * FBX Exporter for Three.js
 * Binary Export (Version 7500)
 *
 * References:
 * - FBX 7500 Binary Format Specifications
 * - Blender FBX Importer
 * - Could use some support for blender imports to convert mats > Principled BSDF
 * - Haven't really messed with blend shapes and such
 */

const FBX_VERSION = 7500;
const KTIME_ONE_SEC = 46186158000n;
const MAGIC_HEADER = 'Kaydara FBX Binary  \x00';
const _FILE_ID = new Uint8Array( [ 0x28, 0xb3, 0x2a, 0xeb, 0xb6, 0x24, 0xcc, 0xc2, 0xbf, 0xc8, 0xb0, 0x2a, 0xa9, 0x2b, 0xfc, 0xf1 ] );
const _TIME_ID = '1970-01-01 10:00:00:000';

class Double {

	constructor( value ) {

		this.value = value;

	}

}

class Float {

	constructor( value ) {

		this.value = value;

	}

}

class Int32 {

	constructor( value ) {

		this.value = value;

	}

}

class FbxRaw {

	constructor( value ) {

		this.value = value;

	}

}

class FbxNode {

	constructor( name ) {

		this.name = name || '';
		this.properties = [];
		this.children = [];

	}

	addProperty( prop ) {

		this.properties.push( prop );
		return this;

	}

	addChild( child ) {

		if ( child ) this.children.push( child );
		return this;

	}

}

function createP( name, type, subtype, flags, values ) {

	const p = new FbxNode( 'P' )
		.addProperty( name )
		.addProperty( type )
		.addProperty( subtype )
		.addProperty( flags );

	if ( values !== undefined ) {

		if ( Array.isArray( values ) ) values.forEach( v => p.addProperty( v ) );
		else p.addProperty( values );

	}

	return p;

}

let idCounter = 1000000n;

function generateId() {

	return idCounter++;

}

function nameWithClass( name, fbxClass ) {

	return `${name}\x00\x01${fbxClass}`;

}

function normalizeMixamoName( name ) {

	if ( ! name ) return name;
	if ( /^mixamorig:/i.test( name ) ) return name;
	if ( /^mixamorig[A-Z]/.test( name ) ) return name.replace( /^mixamorig/, 'mixamorig:' );
	return name;

}

function getRotationOrder( order ) {

	return {
		'XYZ': 0,
		'XZY': 1,
		'YXZ': 2,
		'YZX': 3,
		'ZXY': 4,
		'ZYX': 5
	}[ order ] || 0;

}

function getDataFromImage( image, maxTextureSize = Infinity ) {

	if ( ! image ) return null;

	let canvas, ctx, width = image.width, height = image.height;

	if ( ! width || ! height ) return null;

	if ( width > maxTextureSize || height > maxTextureSize ) {

		const scale = Math.min( maxTextureSize / width, maxTextureSize / height );
		width = Math.floor( width * scale );
		height = Math.floor( height * scale );

	}

	try {

		// Prioritize document.createElement to ensure toDataURL works synchronously
		if ( typeof document !== 'undefined' ) {

			canvas = document.createElement( 'canvas' );
			canvas.width = width;
			canvas.height = height;
			ctx = canvas.getContext( '2d' );

		} else if ( typeof OffscreenCanvas !== 'undefined' ) {

			// Fallback for workers, though toDataURL is usually missing on OffscreenCanvas
			return null;

		} else {

			return null;

		}

		ctx.drawImage( image, 0, 0, width, height );
		const dataURL = canvas.toDataURL( 'image/png' );
		const binary = atob( dataURL.split( ',' )[ 1 ] );
		const bytes = new Uint8Array( binary.length );

		for ( let i = 0; i < binary.length; i ++ ) bytes[ i ] = binary.charCodeAt( i );

		return bytes;

	} catch ( e ) {

		console.warn( 'FBXExporter: Image access failed (CORS or format). Skipping.', e );
		return null;

	}

}

class BinaryWriter {

	constructor( initialSize = 4 * 1024 * 1024 ) {

		this.buffer = new ArrayBuffer( initialSize );
		this.view = new DataView( this.buffer );
		this.offset = 0;
		this.textEncoder = new TextEncoder();

	}

	ensureSpace( size ) {

		if ( this.offset + size > this.buffer.byteLength ) {

			const newSize = Math.max( this.buffer.byteLength * 2, this.offset + size );
			const newBuffer = new ArrayBuffer( newSize );
			new Uint8Array( newBuffer ).set( new Uint8Array( this.buffer ) );
			this.buffer = newBuffer;
			this.view = new DataView( this.buffer );

		}

	}

	writeUint8( v ) {

		this.ensureSpace( 1 );
		this.view.setUint8( this.offset, v );
		this.offset += 1;

	}

	writeUint32( v ) {

		this.ensureSpace( 4 );
		this.view.setUint32( this.offset, v, true );
		this.offset += 4;

	}

	writeInt32( v ) {

		this.ensureSpace( 4 );
		this.view.setInt32( this.offset, v, true );
		this.offset += 4;

	}

	writeFloat32( v ) {

		this.ensureSpace( 4 );
		this.view.setFloat32( this.offset, v, true );
		this.offset += 4;

	}

	writeFloat64( v ) {

		this.ensureSpace( 8 );
		this.view.setFloat64( this.offset, v, true );
		this.offset += 8;

	}

	writeBigUint64( v ) {

		this.ensureSpace( 8 );
		this.view.setBigUint64( this.offset, BigInt( v ), true );
		this.offset += 8;

	}

	writeBigInt64( v ) {

		this.ensureSpace( 8 );
		this.view.setBigInt64( this.offset, BigInt( v ), true );
		this.offset += 8;

	}

	writeBytes( bytes ) {

		this.ensureSpace( bytes.length );
		new Uint8Array( this.buffer ).set( bytes, this.offset );
		this.offset += bytes.length;

	}

	writeProperty( prop ) {

		this.ensureSpace( 1 );

		if ( typeof prop === 'boolean' ) {

			this.writeUint8( 67 );
			this.writeUint8( prop ? 1 : 0 );
			return;

		}

		if ( typeof prop === 'string' ) {

			this.writeUint8( 83 );
			const bytes = this.textEncoder.encode( prop );
			this.writeUint32( bytes.length );
			this.writeBytes( bytes );
			return;

		}

		if ( prop instanceof FbxRaw ) {

			this.writeUint8( 82 );
			this.writeUint32( prop.value.length );
			this.writeBytes( prop.value );
			return;

		}

		if ( typeof prop === 'bigint' ) {

			this.writeUint8( 76 );
			this.writeBigInt64( prop );
			return;

		}

		if ( typeof prop === 'number' || prop instanceof Double || prop instanceof Float || prop instanceof Int32 ) {

			const val = ( prop && prop.value !== undefined ) ? prop.value : prop;

			if ( prop instanceof Int32 ) {

				this.writeUint8( 73 );
				this.writeInt32( val );

			} else if ( prop instanceof Float ) {

				this.writeUint8( 70 );
				this.writeFloat32( val );

			} else if ( Number.isInteger( val ) && ! ( prop instanceof Double ) ) {

				if ( val >= - 2147483648 && val <= 2147483647 ) {

					this.writeUint8( 73 );
					this.writeInt32( val );

				} else {

					this.writeUint8( 76 );
					this.writeBigInt64( val );

				}

			} else {

				this.writeUint8( 68 );
				this.writeFloat64( val );

			}

			return;

		}

		if ( Array.isArray( prop ) ) {

			const len = prop.length;

			if ( len === 0 ) {

				this.writeUint8( 100 );
				this.writeUint32( 0 );
				this.writeUint32( 0 );
				this.writeUint32( 0 );
				return;

			}

			const isBigInt = typeof prop[ 0 ] === 'bigint';
			const isFloat32 = prop[ 0 ] instanceof Float;
			const isInt32 = prop[ 0 ] instanceof Int32;

			let typeCode = 100;
			let byteSize = 8;

			if ( isBigInt ) {

				typeCode = 108;
				byteSize = 8;

			} else if ( isFloat32 ) {

				typeCode = 102;
				byteSize = 4;

			} else if ( isInt32 ) {

				typeCode = 105;
				byteSize = 4;

			}

			this.writeUint8( typeCode );
			this.writeUint32( len );
			this.writeUint32( 0 );
			this.writeUint32( len * byteSize );

			for ( let v of prop ) {

				const val = ( v && v.value !== undefined ) ? v.value : v;

				if ( typeCode === 108 ) this.writeBigInt64( val );
				else if ( typeCode === 102 ) this.writeFloat32( val );
				else if ( typeCode === 105 ) this.writeInt32( val );
				else this.writeFloat64( val );

			}

		}

	}

	writeNode( node ) {

		const startOffset = this.offset;
		this.writeBigUint64( 0n );
		this.writeBigUint64( BigInt( node.properties.length ) );
		this.writeBigUint64( 0n );

		const nameBytes = node.name ? this.textEncoder.encode( node.name ) : new Uint8Array( 0 );
		this.writeUint8( nameBytes.length );

		if ( nameBytes.length > 0 ) this.writeBytes( nameBytes );

		for ( let p of node.properties ) this.writeProperty( p );

		const currentPos = this.offset;
		const headerSize = 25 + nameBytes.length;
		const propLen = currentPos - startOffset - headerSize;

		this.view.setBigUint64( startOffset + 16, BigInt( propLen ), true );

		const forcedSentinel = [ 'AnimationStack', 'AnimationLayer' ].includes( node.name );

		if ( node.children.length > 0 || forcedSentinel ) {

			for ( let child of node.children ) this.writeNode( child );
			this.writeBigUint64( 0n );
			this.writeBigUint64( 0n );
			this.writeBigUint64( 0n );
			this.writeUint8( 0 );

		}

		this.view.setBigUint64( startOffset, BigInt( this.offset ), true );

	}

	getBlob() {

		return new Blob( [ this.buffer.slice( 0, this.offset ) ], { type: 'application/octet-stream' } );

	}

}

class FBXExporter {

	static async export( scene, animations = [], options = {} ) {

		const exporter = new FBXExporter();

		if ( ! Array.isArray( animations ) && typeof animations === 'object' ) {

			options = animations;
			animations = options.animations || [];

		}

		return exporter.parse( scene, options, animations );

	}

	async parse( inputRoot, options = {}, externalAnimations = [] ) {

		const {
			exportSkin = true,
			exportMaterials = true,
			onlyVisible = true,
			embedImages = true,
			maxTextureSize = Infinity,
			scale = 100.0,
			animations = externalAnimations
		} = options;

		inputRoot.updateMatrixWorld( true );

		const objects = [];
		const materials = new Map();
		const textures = new Map();
		const skinnedMeshes = [];
		const boneSet = new Set();

		inputRoot.traverse( obj => {

			if ( onlyVisible && ! obj.visible ) return;
			if ( obj.userData?.export === false ) return;
			if ( obj.isSkeletonHelper || obj.type === 'SkeletonHelper' ) return;

			if ( obj.isGroup || obj.type === 'Group' || obj.isObject3D && ! obj.isMesh && ! obj.isBone && ! obj.isSkinnedMesh ) {

				objects.push( obj );
				return;

			}

			if ( exportSkin && obj.isSkinnedMesh && obj.geometry?.attributes?.position && obj.skeleton ) {

				skinnedMeshes.push( obj );
				objects.push( obj );

				if ( exportMaterials ) {

					const mats = Array.isArray( obj.material ) ? obj.material : [ obj.material ];
					materials.set( obj, mats );

					if ( embedImages ) mats.forEach( m => {

						if ( m.map ) textures.set( m.map.uuid, m.map );

					} );

				}

				return;

			}

			if ( obj.isMesh ) {

				if ( /^(mesh_\d+|widget|handle|helper|bonevis)/i.test( obj.name || '' ) ) return;
				objects.push( obj );

				if ( exportMaterials ) {

					const mats = Array.isArray( obj.material ) ? obj.material : [ obj.material ];
					materials.set( obj, mats );

					if ( embedImages ) mats.forEach( m => {

						if ( m.map ) textures.set( m.map.uuid, m.map );

					} );

				}

			}

		} );

		let hasArmature = false;

		if ( exportSkin && skinnedMeshes.length > 0 ) {

			hasArmature = true;
			skinnedMeshes.forEach( mesh => {

				mesh.skeleton.bones.forEach( b => {

					boneSet.add( b );
					if ( ! objects.includes( b ) ) objects.push( b );

				} );

			} );

		}

		const modelIds = new Map();
		const geometryIds = new Map();
		const materialIds = new Map();
		const textureIds = new Map();
		const videoIds = new Map();

		const deformerIds = new Map();
		const boneIds = new Map();
		const nodeAttributeIds = new Map();

		const clusterToSkins = new Map();
		const clusterToBones = new Map();

		const armatureModelId = hasArmature ? generateId() : null;
		const armatureNodeAttrId = hasArmature ? generateId() : null;

		objects.forEach( obj => {

			if ( ! modelIds.has( obj ) ) modelIds.set( obj, generateId() );
			if ( obj.isBone ) boneIds.set( obj, modelIds.get( obj ) );

		} );

		if ( embedImages ) {

			textures.forEach( tex => {

				if ( ! textureIds.has( tex ) ) textureIds.set( tex, generateId() );
				if ( ! videoIds.has( tex ) ) videoIds.set( tex, generateId() );

			} );

		}

		const objectsNode = new FbxNode( 'Objects' );
		let armWorldMatrix = new THREE.Matrix4();

		if ( armatureModelId ) {

			let rootBoneParent = null;

			if ( skinnedMeshes.length > 0 )
				for ( const b of skinnedMeshes[ 0 ].skeleton.bones )
					if ( ! b.parent || ! b.parent.isBone ) {

						rootBoneParent = b.parent;
						break;

					}

			let armPos = new THREE.Vector3();
			let armQuat = new THREE.Quaternion();
			let armScale = new THREE.Vector3( 1, 1, 1 );

			if ( rootBoneParent ) {

				armWorldMatrix.copy( rootBoneParent.matrixWorld );
				armWorldMatrix.decompose( armPos, armQuat, armScale );

			}

			const armEuler = new THREE.Euler().setFromQuaternion( armQuat, 'XYZ' );

			objectsNode.addChild( new FbxNode( 'Model' )
				.addProperty( BigInt( armatureModelId ) )
				.addProperty( nameWithClass( 'Armature', 'Model' ) )
				.addProperty( 'Null' )
				.addChild( new FbxNode( 'Version' ).addProperty( 232 ) )
				.addChild( new FbxNode( 'Properties70' )
					.addChild( createP( 'Lcl Translation', 'Lcl Translation', '', 'A', [ armPos.x * scale, armPos.y * scale, armPos.z * scale ].map( v => new Double( v ) ) ) )
					.addChild( createP( 'Lcl Rotation', 'Lcl Rotation', '', 'A', [ THREE.MathUtils.radToDeg( armEuler.x ), THREE.MathUtils.radToDeg( armEuler.y ), THREE.MathUtils.radToDeg( armEuler.z ) ].map( v => new Double( v ) ) ) )
					.addChild( createP( 'Lcl Scaling', 'Lcl Scaling', '', 'A', [ armScale.x, armScale.y, armScale.z ].map( v => new Double( v ) ) ) )
					.addChild( createP( 'InheritType', 'enum', '', '', 1 ) )
				)
				.addChild( new FbxNode( 'Shading' ).addProperty( true ) )
				.addChild( new FbxNode( 'Culling' ).addProperty( 'CullingOff' ) )
			);

			objectsNode.addChild( new FbxNode( 'NodeAttribute' )
				.addProperty( BigInt( armatureNodeAttrId ) )
				.addProperty( nameWithClass( 'Armature_Attr', 'NodeAttribute' ) )
				.addProperty( 'Null' )
				.addChild( new FbxNode( 'TypeFlags' ).addProperty( 'Null' ) )
			);

		}

		objects.forEach( obj => {

			const mid = modelIds.get( obj );
			const isBone = obj.isBone;
			const type = isBone ? 'LimbNode' : ( obj.isMesh ? 'Mesh' : 'Null' );

			const model = new FbxNode( 'Model' )
				.addProperty( BigInt( mid ) )
				.addProperty( nameWithClass( obj.name || `${type}_${obj.id}`, 'Model' ) )
				.addProperty( type )
				.addChild( new FbxNode( 'Version' ).addProperty( 232 ) );

			const p70 = new FbxNode( 'Properties70' );
			const t = obj.position;
			const r = obj.rotation;
			const s = obj.scale;

			p70.addChild( createP( 'Lcl Translation', 'Lcl Translation', '', 'A', [ t.x * scale, t.y * scale, t.z * scale ].map( v => new Double( v ) ) ) )
				.addChild( createP( 'Lcl Rotation', 'Lcl Rotation', '', 'A', [ THREE.MathUtils.radToDeg( r.x ), THREE.MathUtils.radToDeg( r.y ), THREE.MathUtils.radToDeg( r.z ) ].map( v => new Double( v ) ) ) )
				.addChild( createP( 'Lcl Scaling', 'Lcl Scaling', '', 'A', [ s.x, s.y, s.z ].map( v => new Double( v ) ) ) )
				.addChild( createP( 'RotationOrder', 'enum', '', '', getRotationOrder( obj.rotation.order ) ) )
				.addChild( createP( 'InheritType', 'enum', '', '', 1 ) );

			if ( isBone ) {

				p70.addChild( createP( 'RotationActive', 'bool', '', '', 1 ) );
				p70.addChild( createP( 'SegmentScaleCompensate', 'bool', '', '', 1 ) );

			}

			model.addChild( p70 )
				.addChild( new FbxNode( 'Shading' ).addProperty( true ) )
				.addChild( new FbxNode( 'Culling' ).addProperty( 'CullingOff' ) );

			objectsNode.addChild( model );

			if ( isBone ) {

				const naId = generateId();
				nodeAttributeIds.set( obj, naId );
				objectsNode.addChild( new FbxNode( 'NodeAttribute' )
					.addProperty( BigInt( naId ) )
					.addProperty( nameWithClass( obj.name || 'Bone', 'NodeAttribute' ) )
					.addProperty( 'LimbNode' )
					.addChild( new FbxNode( 'TypeFlags' ).addProperty( 'Skeleton' ) )
				);

			}

			if ( obj.isMesh ) {

				const gid = generateId();
				geometryIds.set( obj, gid );

				const mats = materials.get( obj ) || [ new THREE.MeshLambertMaterial( { color: 0x888888 } ) ];
				const mIds = mats.map( () => generateId() );
				mIds.forEach( ( id, i ) => materialIds.set( `${obj.id}_${i}`, id ) );

				objectsNode.addChild( this._exportGeometry( obj, gid, scale, exportSkin ) );
				mats.forEach( ( m, i ) => objectsNode.addChild( this._exportMaterial( m, mIds[ i ] ) ) );

			}

		} );

		const validTextureIds = new Set();

		if ( embedImages ) {

			textures.forEach( ( tex, uuid ) => {

				const vid = videoIds.get( tex );
				const tid = textureIds.get( tex );
				const bytes = getDataFromImage( tex.image, maxTextureSize );

				if ( bytes ) {

					validTextureIds.add( tid );
					let rawName = ( tex.name || 'Texture' ).replace( /[^a-zA-Z0-9]/g, '_' );
					if ( ! rawName ) rawName = `Texture_${uuid}`;
					const fileName = `${rawName}.png`;

					objectsNode.addChild( new FbxNode( 'Video' )
						.addProperty( BigInt( vid ) )
						.addProperty( nameWithClass( 'Video', 'Video' ) )
						.addProperty( 'Clip' )
						.addChild( new FbxNode( 'Type' ).addProperty( 'Clip' ) )
						.addChild( new FbxNode( 'Properties70' ).addChild( createP( 'Path', 'KString', 'XRefUrl', '', '' ) ) )
						.addChild( new FbxNode( 'UseUserData' ).addProperty( 0 ) )
						.addChild( new FbxNode( 'Content' ).addProperty( new FbxRaw( bytes ) ) )
						.addChild( new FbxNode( 'Filename' ).addProperty( fileName ) )
						.addChild( new FbxNode( 'RelativeFilename' ).addProperty( fileName ) )
					);

					objectsNode.addChild( new FbxNode( 'Texture' )
						.addProperty( BigInt( tid ) )
						.addProperty( nameWithClass( rawName, 'Texture' ) )
						.addProperty( '' )
						.addChild( new FbxNode( 'Type' ).addProperty( 'TextureVideoClip' ) )
						.addChild( new FbxNode( 'Version' ).addProperty( 202 ) )
						.addChild( new FbxNode( 'TextureName' ).addProperty( nameWithClass( rawName, 'Texture' ) ) )
						.addChild( new FbxNode( 'Media' ).addProperty( nameWithClass( 'Video', 'Video' ) ) )
						.addChild( new FbxNode( 'FileName' ).addProperty( fileName ) )
						.addChild( new FbxNode( 'RelativeFilename' ).addProperty( fileName ) )
						.addChild( new FbxNode( 'Properties70' )
							.addChild( createP( 'UseMaterial', 'bool', '', '', 1 ) )
							.addChild( createP( 'UseMipMap', 'bool', '', '', 0 ) )
						)
					);

				}

			} );

		}

		if ( exportSkin ) {

			for ( const mesh of skinnedMeshes ) {

				const meshBindGlobal = mesh.matrixWorld.clone();
				const boneBindGlobals = new Map();
				boneSet.forEach( b => boneBindGlobals.set( b, b.matrixWorld.clone() ) );

				const skinResult = this._exportSkin( mesh, modelIds.get( mesh ), geometryIds.get( mesh ), boneIds, clusterToSkins, clusterToBones, meshBindGlobal, boneBindGlobals, scale );

				if ( skinResult ) {

					objectsNode.addChild( skinResult.skinNode );
					skinResult.clusters.forEach( c => objectsNode.addChild( c ) );
					deformerIds.set( mesh, skinResult.skinId );
					objectsNode.addChild( this._exportBindPose( modelIds.get( mesh ), Array.from( boneSet ), modelIds, meshBindGlobal, boneBindGlobals, armatureModelId, armWorldMatrix, scale ) );

				}

			}

		}

		const { animNodes, animConnections, stackIds, layerIds } = this._exportAnimations( animations, boneIds, scale );
		animNodes.forEach( n => objectsNode.addChild( n ) );

		const headerExt = this._generateHeader();
		const globalSettings = this._generateGlobalSettings();
		const docNode = this._generateDocument( stackIds, animations );
		const definitions = this._generateDefinitions( objects.length + ( armatureModelId ? 1 : 0 ), geometryIds.size, materialIds.size, textureIds.size, videoIds.size, deformerIds.size, stackIds.length );

		const connections = new FbxNode( 'Connections' );

		objects.forEach( obj => {

			const id = modelIds.get( obj );
			if ( ! id ) return;

			let parentId = 0n;
			const isRootBone = obj.isBone && ( ! obj.parent || ! obj.parent.isBone );

			if ( armatureModelId && isRootBone ) parentId = BigInt( armatureModelId );
			else if ( obj.parent && modelIds.has( obj.parent ) ) parentId = BigInt( modelIds.get( obj.parent ) );

			connections.addChild( new FbxNode( 'C' ).addProperty( 'OO' ).addProperty( BigInt( id ) ).addProperty( parentId ) );

		} );

		if ( armatureModelId ) connections.addChild( new FbxNode( 'C' ).addProperty( 'OO' ).addProperty( BigInt( armatureModelId ) ).addProperty( 0n ) );
		if ( armatureModelId && armatureNodeAttrId ) connections.addChild( new FbxNode( 'C' ).addProperty( 'OO' ).addProperty( BigInt( armatureNodeAttrId ) ).addProperty( BigInt( armatureModelId ) ) );

		nodeAttributeIds.forEach( ( naId, bone ) => {

			const mid = modelIds.get( bone );
			if ( mid ) connections.addChild( new FbxNode( 'C' ).addProperty( 'OO' ).addProperty( BigInt( naId ) ).addProperty( BigInt( mid ) ) );

		} );

		geometryIds.forEach( ( gid, obj ) => {

			const mid = modelIds.get( obj );
			if ( mid ) connections.addChild( new FbxNode( 'C' ).addProperty( 'OO' ).addProperty( BigInt( gid ) ).addProperty( BigInt( mid ) ) );

		} );

		materialIds.forEach( ( matId, key ) => {

			const [ objId ] = key.split( '_' );
			const obj = [ ...modelIds.keys() ].find( o => o.id === parseInt( objId ) );
			const mid = obj ? modelIds.get( obj ) : null;
			if ( mid ) connections.addChild( new FbxNode( 'C' ).addProperty( 'OO' ).addProperty( BigInt( matId ) ).addProperty( BigInt( mid ) ) );

		} );

		deformerIds.forEach( ( skinId, obj ) => {

			const gid = geometryIds.get( obj );
			if ( gid ) connections.addChild( new FbxNode( 'C' ).addProperty( 'OO' ).addProperty( BigInt( skinId ) ).addProperty( BigInt( gid ) ) );

		} );

		clusterToSkins.forEach( ( skinId, clusterId ) => connections.addChild( new FbxNode( 'C' ).addProperty( 'OO' ).addProperty( BigInt( clusterId ) ).addProperty( BigInt( skinId ) ) ) );
		clusterToBones.forEach( ( boneId, clusterId ) => connections.addChild( new FbxNode( 'C' ).addProperty( 'OO' ).addProperty( BigInt( boneId ) ).addProperty( BigInt( clusterId ) ) ) );

		if ( embedImages ) {

			textures.forEach( ( tex, uuid ) => {

				const vid = videoIds.get( tex );
				const tid = textureIds.get( tex );

				if ( vid && tid && validTextureIds.has( tid ) ) {

					connections.addChild( new FbxNode( 'C' ).addProperty( 'OO' ).addProperty( BigInt( vid ) ).addProperty( BigInt( tid ) ) );
					materials.forEach( ( mats, obj ) => {

						mats.forEach( ( m, i ) => {

							if ( m.map === tex ) {

								const matId = materialIds.get( `${obj.id}_${i}` );
								if ( matId ) connections.addChild( new FbxNode( 'C' ).addProperty( 'OP' ).addProperty( BigInt( tid ) ).addProperty( BigInt( matId ) ).addProperty( 'DiffuseColor' ) );

							}

						} );

					} );

				}

			} );

		}

		if ( animConnections ) animConnections.forEach( c => connections.addChild( c ) );

		const rootNodes = [ headerExt, globalSettings, new FbxNode( 'Documents' ).addChild( new FbxNode( 'Count' ).addProperty( 1 ) ).addChild( docNode ), new FbxNode( 'References' ), definitions, objectsNode, connections ];
		const writer = new BinaryWriter();

		for ( let i = 0; i < MAGIC_HEADER.length; i ++ ) writer.writeUint8( MAGIC_HEADER.charCodeAt( i ) );
		writer.writeUint8( 26 );
		writer.writeUint8( 0 );
		writer.writeUint32( FBX_VERSION );

		const implicitRoot = new FbxNode( '' )
			.addChild( new FbxNode( 'FileId' ).addProperty( new FbxRaw( _FILE_ID ) ) )
			.addChild( new FbxNode( 'CreationTime' ).addProperty( _TIME_ID ) )
			.addChild( new FbxNode( 'Creator' ).addProperty( 'Three.js FBX Exporter' ) );

		for ( let i = 0; i < rootNodes.length; i ++ ) implicitRoot.addChild( rootNodes[ i ] );
		for ( let child of implicitRoot.children ) writer.writeNode( child );

		writer.writeBigUint64( 0n );
		writer.writeBigUint64( 0n );
		writer.writeBigUint64( 0n );
		writer.writeUint8( 0 );

		const footerId = [ 0xFA, 0xBC, 0xAB, 0x09, 0xD0, 0xC8, 0xD4, 0x66, 0xB1, 0x76, 0xFB, 0x83, 0x1C, 0xF7, 0x26, 0x7E ];
		for ( let b of footerId ) writer.writeUint8( b );
		for ( let i = 0; i < 4; i ++ ) writer.writeUint8( 0 );

		const p = ( ( writer.offset + 15 ) & ~ 15 ) - writer.offset || 16;
		for ( let i = 0; i < p; i ++ ) writer.writeUint8( 0 );

		writer.writeInt32( FBX_VERSION );
		for ( let i = 0; i < 120; i ++ ) writer.writeUint8( 0 );

		const footerMagic = [ 0xF8, 0x5A, 0x8C, 0x6A, 0xDE, 0xF5, 0xD9, 0x7E, 0xEC, 0xE9, 0x0C, 0xE3, 0x75, 0x8F, 0x29, 0x0B ];
		for ( let b of footerMagic ) writer.writeUint8( b );

		return writer.getBlob();

	}

	_generateHeader() {

		return new FbxNode( 'FBXHeaderExtension' )
			.addChild( new FbxNode( 'FBXHeaderVersion' ).addProperty( 1003 ) )
			.addChild( new FbxNode( 'FBXVersion' ).addProperty( FBX_VERSION ) )
			.addChild( new FbxNode( 'CreationTimeStamp' )
				.addChild( new FbxNode( 'Version' ).addProperty( 1000 ) )
				.addChild( new FbxNode( 'Year' ).addProperty( 2025 ) )
				.addChild( new FbxNode( 'Month' ).addProperty( 1 ) )
				.addChild( new FbxNode( 'Day' ).addProperty( 1 ) )
			)
			.addChild( new FbxNode( 'SceneInfo' )
				.addProperty( nameWithClass( 'GlobalInfo', 'SceneInfo' ) )
				.addProperty( 'UserData' )
				.addChild( new FbxNode( 'Type' ).addProperty( 'UserData' ) )
				.addChild( new FbxNode( 'Version' ).addProperty( 100 ) )
			);

	}

	_generateGlobalSettings() {

		return new FbxNode( 'GlobalSettings' )
			.addChild( new FbxNode( 'Version' ).addProperty( 1000 ) )
			.addChild( new FbxNode( 'Properties70' )
				.addChild( createP( 'UpAxis', 'int', 'Integer', '', 1 ) )
				.addChild( createP( 'UpAxisSign', 'int', 'Integer', '', 1 ) )
				.addChild( createP( 'FrontAxis', 'int', 'Integer', '', 2 ) )
				.addChild( createP( 'FrontAxisSign', 'int', 'Integer', '', 1 ) )
				.addChild( createP( 'CoordAxis', 'int', 'Integer', '', 0 ) )
				.addChild( createP( 'CoordAxisSign', 'int', 'Integer', '', 1 ) )
				.addChild( createP( 'UnitScaleFactor', 'double', 'Number', '', new Double( 1.0 ) ) )
			);

	}

	_generateDocument( stackIds, clips ) {

		const props = new FbxNode( 'Properties70' ).addChild( createP( 'SourceObject', 'object', '', '' ) );
		if ( stackIds.length > 0 && clips.length > 0 ) props.addChild( createP( 'ActiveAnimStackName', 'KString', '', '', clips[ 0 ].name || 'Anim_0' ) );

		return new FbxNode( 'Document' )
			.addProperty( BigInt( generateId() ) )
			.addProperty( 'Document::Scene' )
			.addProperty( '' )
			.addChild( props )
			.addChild( new FbxNode( 'RootNode' ).addProperty( 0n ) );

	}

	_generateDefinitions( modelCount, geomCount, matCount, texCount, vidCount, skinCount, animCount ) {

		const defs = new FbxNode( 'Definitions' )
			.addChild( new FbxNode( 'Version' ).addProperty( 100 ) )
			.addChild( new FbxNode( 'Count' ).addProperty( new Int32( 7 ) ) );

		const add = ( t, c ) => {

			if ( c > 0 ) defs.addChild( new FbxNode( 'ObjectType' ).addProperty( t ).addChild( new FbxNode( 'Count' ).addProperty( new Int32( c ) ) ) );

		};

		add( 'GlobalSettings', 1 );
		add( 'Model', modelCount );
		add( 'Geometry', geomCount );
		add( 'Material', matCount );
		add( 'Texture', texCount );
		add( 'Video', vidCount );
		add( 'Deformer', skinCount );
		add( 'AnimationStack', animCount );

		return defs;

	}

	_exportGeometry( mesh, geometryId, scale, exportSkin ) {

		const geometry = mesh.geometry;
		const vertices = Array.from( geometry.attributes.position.array ).map( v => new Double( v * scale ) );

		let indices = geometry.index ? Array.from( geometry.index.array ) : Array.from( { length: geometry.attributes.position.count }, ( _, i ) => i );
		indices = indices.map( ( i, idx ) => ( idx % 3 === 2 ? - ( i + 1 ) : i ) );

		const node = new FbxNode( 'Geometry' )
			.addProperty( BigInt( geometryId ) )
			.addProperty( nameWithClass( mesh.name || 'Mesh', 'Geometry' ) )
			.addProperty( 'Mesh' )
			.addChild( new FbxNode( 'Vertices' ).addProperty( vertices ) )
			.addChild( new FbxNode( 'PolygonVertexIndex' ).addProperty( indices ) );

		if ( geometry.attributes.normal ) {

			const normals = [];
			const src = geometry.attributes.normal.array;

			for ( let i = 0; i < indices.length; i ++ ) {

				let idx = indices[ i ];
				if ( idx < 0 ) idx = - idx - 1;
				normals.push( new Double( src[ idx * 3 ] ), new Double( src[ idx * 3 + 1 ] ), new Double( src[ idx * 3 + 2 ] ) );

			}

			node.addChild( new FbxNode( 'LayerElementNormal' )
				.addProperty( 0 )
				.addChild( new FbxNode( 'Version' ).addProperty( 101 ) )
				.addChild( new FbxNode( 'MappingInformationType' ).addProperty( 'ByPolygonVertex' ) )
				.addChild( new FbxNode( 'ReferenceInformationType' ).addProperty( 'Direct' ) )
				.addChild( new FbxNode( 'Normals' ).addProperty( normals ) )
			);

		}

		if ( geometry.attributes.uv ) {

			const uvs = [];
			const src = geometry.attributes.uv.array;

			for ( let i = 0; i < indices.length; i ++ ) {

				let idx = indices[ i ];
				if ( idx < 0 ) idx = - idx - 1;
				uvs.push( new Double( src[ idx * 2 ] ), new Double( src[ idx * 2 + 1 ] ) );

			}

			node.addChild( new FbxNode( 'LayerElementUV' )
				.addProperty( 0 )
				.addChild( new FbxNode( 'Version' ).addProperty( 101 ) )
				.addChild( new FbxNode( 'Name' ).addProperty( 'map1' ) )
				.addChild( new FbxNode( 'MappingInformationType' ).addProperty( 'ByPolygonVertex' ) )
				.addChild( new FbxNode( 'ReferenceInformationType' ).addProperty( 'Direct' ) )
				.addChild( new FbxNode( 'UV' ).addProperty( uvs ) )
			);

		}

		const matIndices = new Array( Math.floor( indices.length / 3 ) ).fill( 0 );

		node.addChild( new FbxNode( 'LayerElementMaterial' )
			.addProperty( 0 )
			.addChild( new FbxNode( 'Version' ).addProperty( 101 ) )
			.addChild( new FbxNode( 'MappingInformationType' ).addProperty( 'ByPolygon' ) )
			.addChild( new FbxNode( 'ReferenceInformationType' ).addProperty( 'IndexToDirect' ) )
			.addChild( new FbxNode( 'Materials' ).addProperty( matIndices ) )
		);

		const layer = new FbxNode( 'Layer' )
			.addProperty( 0 )
			.addChild( new FbxNode( 'Version' ).addProperty( 100 ) );

		if ( geometry.attributes.normal ) layer.addChild( new FbxNode( 'LayerElement' ).addChild( new FbxNode( 'Type' ).addProperty( 'LayerElementNormal' ) ).addChild( new FbxNode( 'TypedIndex' ).addProperty( 0 ) ) );
		if ( geometry.attributes.uv ) layer.addChild( new FbxNode( 'LayerElement' ).addChild( new FbxNode( 'Type' ).addProperty( 'LayerElementUV' ) ).addChild( new FbxNode( 'TypedIndex' ).addProperty( 0 ) ) );

		layer.addChild( new FbxNode( 'LayerElement' ).addChild( new FbxNode( 'Type' ).addProperty( 'LayerElementMaterial' ) ).addChild( new FbxNode( 'TypedIndex' ).addProperty( 0 ) ) );
		node.addChild( layer );

		if ( exportSkin && geometry.attributes.skinIndex && geometry.attributes.skinWeight && mesh.skeleton ) {

			node.addChild( new FbxNode( 'VertexGroups' ).addProperty( mesh.skeleton.bones.map( b => normalizeMixamoName( b.name ) ) ) );

		}

		return node;

	}

	_exportMaterial( material, materialId ) {

		const node = new FbxNode( 'Material' )
			.addProperty( BigInt( materialId ) )
			.addProperty( nameWithClass( material.name || 'Material', 'Material' ) )
			.addProperty( 'Material' );

		node.addChild( new FbxNode( 'Version' ).addProperty( 102 ) )
			.addChild( new FbxNode( 'ShadingModel' ).addProperty( 'Lambert' ) )
			.addChild( new FbxNode( 'MultiLayer' ).addProperty( 0 ) );

		const color = material.color || new THREE.Color( 0.5, 0.5, 0.5 );
		const props = new FbxNode( 'Properties70' )
			.addChild( createP( 'DiffuseColor', 'ColorRGB', 'Color', 'A', [ new Double( color.r ), new Double( color.g ), new Double( color.b ) ] ) )
			.addChild( createP( 'TransparencyFactor', 'Number', '', 'A', new Double( 1.0 - ( material.opacity ?? 1.0 ) ) ) );

		node.addChild( props );
		return node;

	}

	_exportSkin( mesh, mid, gid, bIds, cToS, cToB, meshBind, boneBinds, scale ) {

		if ( ! mesh.geometry.attributes.skinIndex ) return null;

		const skinId = generateId();
		const skinNode = new FbxNode( 'Deformer' ).addProperty( BigInt( skinId ) ).addProperty( nameWithClass( `Skin_${gid}`, 'Deformer' ) ).addProperty( 'Skin' );
		const clusters = [];
		const weights = mesh.geometry.attributes.skinWeight.array;
		const indices = mesh.geometry.attributes.skinIndex.array;
		const boneInverses = mesh.skeleton.boneInverses;

		mesh.skeleton.bones.forEach( ( bone, index ) => {

			const clusterId = generateId();
			const clusterNode = new FbxNode( 'Deformer' )
				.addProperty( BigInt( clusterId ) )
				.addProperty( nameWithClass( normalizeMixamoName( bone.name ), 'Deformer' ) )
				.addProperty( 'Cluster' );

			const boneIndices = [], boneWeights = [];

			for ( let i = 0; i < mesh.geometry.attributes.position.count; i ++ ) {

				for ( let j = 0; j < 4; j ++ ) {

					if ( indices[ i * 4 + j ] === index && weights[ i * 4 + j ] > 0 ) {

						boneIndices.push( i );
						boneWeights.push( weights[ i * 4 + j ] );

					}

				}

			}

			let transformLink = new THREE.Matrix4();
			if ( boneInverses && boneInverses.length > index ) transformLink.copy( boneInverses[ index ] ).invert().premultiply( meshBind );
			else transformLink.copy( bone.matrixWorld );

			const writeM = ( m ) => {

				const e = [ ...m.elements ];
				e[ 12 ] *= scale;
				e[ 13 ] *= scale;
				e[ 14 ] *= scale;
				return e.map( v => new Double( v ) );

			};

			clusterNode.addChild( new FbxNode( 'Indexes' ).addProperty( boneIndices ) )
				.addChild( new FbxNode( 'Weights' ).addProperty( boneWeights.map( v => new Double( v ) ) ) );

			clusterNode.addChild( new FbxNode( 'Transform' ).addProperty( writeM( meshBind ) ) );
			clusterNode.addChild( new FbxNode( 'TransformLink' ).addProperty( writeM( transformLink ) ) );
			clusterNode.addChild( new FbxNode( 'LinkMode' ).addProperty( 'Normalize' ) );

			clusters.push( clusterNode );
			cToS.set( clusterId, skinId );
			cToB.set( clusterId, bIds.get( bone ) );

		} );

		return { skinNode, clusters, skinId };

	}

	_exportBindPose( mid, bones, mIds, meshBind, boneBinds, armId, armMx, scale ) {

		const pose = new FbxNode( 'Pose' )
			.addProperty( BigInt( generateId() ) )
			.addProperty( nameWithClass( 'BindPose', 'Pose' ) )
			.addProperty( 'BindPose' );

		pose.addChild( new FbxNode( 'Type' ).addProperty( 'BindPose' ) )
			.addChild( new FbxNode( 'NbPoseNodes' ).addProperty( 1 + bones.length + ( armId ? 1 : 0 ) ) );

		const writeM = ( m ) => {

			const e = [ ...m.elements ];
			e[ 12 ] *= scale;
			e[ 13 ] *= scale;
			e[ 14 ] *= scale;
			return e.map( v => new Double( v ) );

		};

		if ( armId ) pose.addChild( new FbxNode( 'PoseNode' ).addChild( new FbxNode( 'Node' ).addProperty( BigInt( armId ) ) ).addChild( new FbxNode( 'Matrix' ).addProperty( writeM( armMx ) ) ) );
		pose.addChild( new FbxNode( 'PoseNode' ).addChild( new FbxNode( 'Node' ).addProperty( BigInt( mid ) ) ).addChild( new FbxNode( 'Matrix' ).addProperty( writeM( meshBind ) ) ) );

		bones.forEach( b => {

			const id = mIds.get( b );
			if ( id ) pose.addChild( new FbxNode( 'PoseNode' ).addChild( new FbxNode( 'Node' ).addProperty( BigInt( id ) ) ).addChild( new FbxNode( 'Matrix' ).addProperty( writeM( boneBinds.get( b ) || b.matrixWorld ) ) ) );

		} );

		return pose;

	}

	_exportAnimations( clips, boneIds, scale ) {

		const animNodes = [], animConnections = [], stackIds = [], layerIds = [];

		clips.forEach( ( clip, i ) => {

			const stackId = generateId();
			const layerId = generateId();

			stackIds.push( stackId );
			layerIds.push( layerId );

			const duration = BigInt( Math.round( clip.duration * Number( KTIME_ONE_SEC ) ) );
			const stack = new FbxNode( 'AnimationStack' )
				.addProperty( BigInt( stackId ) )
				.addProperty( nameWithClass( clip.name || `Anim_${i}`, 'AnimStack' ) )
				.addProperty( '' );

			stack.addChild( new FbxNode( 'Properties70' )
				.addChild( createP( 'LocalStop', 'KTime', 'Time', '', duration ) )
				.addChild( createP( 'ReferenceStop', 'KTime', 'Time', '', duration ) )
			);

			animNodes.push( stack );
			animNodes.push( new FbxNode( 'AnimationLayer' )
				.addProperty( BigInt( layerId ) )
				.addProperty( nameWithClass( 'Layer0', 'AnimLayer' ) )
				.addProperty( '' )
			);

			animConnections.push( new FbxNode( 'C' ).addProperty( 'OO' ).addProperty( BigInt( layerId ) ).addProperty( BigInt( stackId ) ) );

			clip.tracks.forEach( track => {

				const [ boneName, prop ] = track.name.split( '.' );
				const bone = [ ...boneIds.keys() ].find( b => normalizeMixamoName( b.name ) === normalizeMixamoName( boneName ) );
				if ( ! bone ) return;

				const boneId = boneIds.get( bone );
				const curveNodeId = generateId();
				const times = Array.from( track.times ).map( t => BigInt( Math.round( t * Number( KTIME_ONE_SEC ) ) ) );
				const values = Array.from( track.values );
				let keyAttr = '', data = [];

				if ( prop === 'position' ) {

					keyAttr = 'T';
					data = values.map( v => v * scale );

				} else if ( prop === 'scale' ) {

					keyAttr = 'S';
					data = values;

				} else if ( prop === 'quaternion' ) {

					keyAttr = 'R';
					const eulers = [];
					const last = new THREE.Euler();

					for ( let k = 0; k < values.length; k += 4 ) {

						const e = new THREE.Euler().setFromQuaternion( new THREE.Quaternion().fromArray( values, k ) );

						if ( k > 0 ) {

							if ( Math.abs( e.x - last.x ) > Math.PI ) e.x -= Math.sign( e.x - last.x ) * 2 * Math.PI;
							if ( Math.abs( e.y - last.y ) > Math.PI ) e.y -= Math.sign( e.y - last.y ) * 2 * Math.PI;
							if ( Math.abs( e.z - last.z ) > Math.PI ) e.z -= Math.sign( e.z - last.z ) * 2 * Math.PI;

						}

						last.copy( e );
						eulers.push( THREE.MathUtils.radToDeg( e.x ), THREE.MathUtils.radToDeg( e.y ), THREE.MathUtils.radToDeg( e.z ) );

					}

					data = eulers;

				} else return;

				const curveNode = new FbxNode( 'AnimationCurveNode' )
					.addProperty( BigInt( curveNodeId ) )
					.addProperty( nameWithClass( keyAttr, 'AnimCurveNode' ) )
					.addProperty( '' );

				curveNode.addChild( new FbxNode( 'Properties70' )
					.addChild( createP( 'd', 'Compound', '', '' ) )
					.addChild( createP( 'd|X', 'Number', '', 'A', new Double( data[ 0 ] || 0 ) ) )
					.addChild( createP( 'd|Y', 'Number', '', 'A', new Double( data[ 1 ] || 0 ) ) )
					.addChild( createP( 'd|Z', 'Number', '', 'A', new Double( data[ 2 ] || 0 ) ) )
				);

				animNodes.push( curveNode );
				animConnections.push( new FbxNode( 'C' ).addProperty( 'OO' ).addProperty( BigInt( curveNodeId ) ).addProperty( BigInt( layerId ) ) );
				animConnections.push( new FbxNode( 'C' ).addProperty( 'OP' ).addProperty( BigInt( curveNodeId ) ).addProperty( BigInt( boneId ) ).addProperty( prop === 'position' ? 'Lcl Translation' : prop === 'scale' ? 'Lcl Scaling' : 'Lcl Rotation' ) );

				[ 'X', 'Y', 'Z' ].forEach( ( axis, axIdx ) => {

					const curveId = generateId();
					const val = data.filter( ( _, i ) => i % 3 === axIdx ).map( v => new Float( v ) );

					animNodes.push( new FbxNode( 'AnimationCurve' )
						.addProperty( BigInt( curveId ) )
						.addProperty( nameWithClass( '', 'AnimCurve' ) )
						.addProperty( '' )
						.addChild( new FbxNode( 'KeyTime' ).addProperty( times ) )
						.addChild( new FbxNode( 'KeyValueFloat' ).addProperty( val ) )
						.addChild( new FbxNode( 'KeyAttrFlags' ).addProperty( new Array( times.length ).fill( 256 ) ) )
						.addChild( new FbxNode( 'KeyAttrDataFloat' ).addProperty( new Array( times.length * 4 ).fill( new Float( 0 ) ) ) )
						.addChild( new FbxNode( 'KeyAttrRefCount' ).addProperty( new Array( times.length ).fill( 1 ) ) )
					);

					animConnections.push( new FbxNode( 'C' ).addProperty( 'OP' ).addProperty( BigInt( curveId ) ).addProperty( BigInt( curveNodeId ) ).addProperty( `d|${axis}` ) );

				} );

			} );

		} );

		return { animNodes, animConnections, stackIds, layerIds };

	}

}

export { FBXExporter };