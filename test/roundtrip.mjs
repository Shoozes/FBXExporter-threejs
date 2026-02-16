import fs from 'fs';
import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { FBXExporter } from '../examples/jsm/exporters/FBXExporter.js';

const TOLERANCE = 0.01;

function compareMatrices( a, b ) {

	let maxDiff = 0;
	for ( let i = 0; i < 16; i ++ ) {

		const diff = Math.abs( a.elements[ i ] - b.elements[ i ] );
		if ( diff > maxDiff ) maxDiff = diff;

	}

	return maxDiff;

}

function quatToStr( q ) {

	return `(${q.x.toFixed( 4 )}, ${q.y.toFixed( 4 )}, ${q.z.toFixed( 4 )}, ${q.w.toFixed( 4 )})`;

}

// Collect first-occurrence-only bone map to avoid duplicates
function collectBones( root ) {

	const map = new Map();
	root.traverse( obj => {

		if ( obj.isBone && ! map.has( obj.name ) ) {

			map.set( obj.name, obj );

		}

	} );
	return map;

}

// Load the original FBX
const data = fs.readFileSync( new URL( '../test.fbx', import.meta.url ) );
const buffer = data.buffer.slice( data.byteOffset, data.byteOffset + data.byteLength );

const loader = new FBXLoader();
const original = loader.parse( buffer, '' );
original.updateMatrixWorld( true );
console.log( 'Original model loaded.' );

const originalBoneMap = collectBones( original );

const originalMeshes = [];
original.traverse( obj => {

	if ( obj.isSkinnedMesh ) {

		originalMeshes.push( {
			name: obj.name,
			bindMatrix: obj.bindMatrix.clone(),
			boneInverses: obj.skeleton.boneInverses.map( m => m.clone() ),
			boneNames: obj.skeleton.bones.map( b => b.name )
		} );

	}

} );

const clips = original.animations.filter( c => c.tracks.length > 0 );
console.log( `Found ${originalBoneMap.size} unique bones, ${originalMeshes.length} skinned meshes, ${clips.length} animation clip(s)` );

// Export using FBXExporter (with animations)
const exporter = new FBXExporter();
const blob = await exporter.parse( original, {
	exportSkin: true,
	exportMaterials: false,
	embedImages: false,
	scale: 1,
	animations: clips
} );

const exportedBuffer = await blob.arrayBuffer();
console.log( `Exported ${exportedBuffer.byteLength} bytes` );

// Re-import
const loader2 = new FBXLoader();
const reimported = loader2.parse( exportedBuffer, '' );
reimported.updateMatrixWorld( true );
console.log( 'Re-imported model loaded.' );

const reimportedBoneMap = collectBones( reimported );

const reimportedMeshes = [];
reimported.traverse( obj => {

	if ( obj.isSkinnedMesh ) {

		reimportedMeshes.push( {
			name: obj.name,
			bindMatrix: obj.bindMatrix.clone(),
			boneInverses: obj.skeleton.boneInverses.map( m => m.clone() ),
			boneNames: obj.skeleton.bones.map( b => b.name )
		} );

	}

} );

const reimClips = reimported.animations.filter( c => c.tracks.length > 0 );
console.log( `Re-imported: ${reimportedBoneMap.size} unique bones, ${reimportedMeshes.length} skinned meshes, ${reimClips.length} animation clip(s)` );

// ===== BIND POSE TEST =====
console.log( '\n=== BIND POSE TEST ===' );
let maxError = 0;
let errorCount = 0;

for ( const origMesh of originalMeshes ) {

	const reimportMesh = reimportedMeshes.find( m => m.name === origMesh.name );
	if ( ! reimportMesh ) {

		console.error( `FAIL: Mesh "${origMesh.name}" not found in re-imported model` );
		errorCount ++;
		continue;

	}

	console.log( `\nComparing mesh: ${origMesh.name}` );

	const bindMatrixDiff = compareMatrices( origMesh.bindMatrix, reimportMesh.bindMatrix );
	console.log( `  Bind matrix max element diff: ${bindMatrixDiff.toFixed( 6 )}` );
	if ( bindMatrixDiff > TOLERANCE ) {

		console.error( `  FAIL: Bind matrix difference too large: ${bindMatrixDiff}` );
		errorCount ++;

	}

	const count = Math.min( origMesh.boneInverses.length, reimportMesh.boneInverses.length );
	for ( let i = 0; i < count; i ++ ) {

		const diff = compareMatrices( origMesh.boneInverses[ i ], reimportMesh.boneInverses[ i ] );
		if ( diff > maxError ) maxError = diff;

		if ( diff > TOLERANCE ) {

			if ( errorCount < 5 ) {

				console.error( `  FAIL bone[${i}] "${origMesh.boneNames[ i ]}": inverse matrix diff = ${diff.toFixed( 6 )}` );

			}

			errorCount ++;

		}

	}

}

let worldMaxError = 0;
let worldErrorCount = 0;

for ( const [ name, origBone ] of originalBoneMap ) {

	const reimBone = reimportedBoneMap.get( name );
	if ( ! reimBone ) continue;

	const qDot = Math.abs( origBone.quaternion.dot( reimBone.quaternion ) );
	const qError = 1 - qDot;

	if ( qError > TOLERANCE ) {

		worldErrorCount ++;
		if ( worldErrorCount <= 5 ) {

			console.error( `  FAIL bone "${name}" quaternion: dot=${qDot.toFixed( 6 )}, error=${qError.toFixed( 6 )}` );
			console.log( `    Original:    ${quatToStr( origBone.quaternion )}` );
			console.log( `    Re-imported: ${quatToStr( reimBone.quaternion )}` );

		}

	}

	if ( qError > worldMaxError ) worldMaxError = qError;

}

console.log( '\n--- Bind Pose Results ---' );
console.log( `Max bone inverse error: ${maxError.toFixed( 6 )}` );
console.log( `Max world quaternion error: ${worldMaxError.toFixed( 6 )}` );
console.log( `Bone inverse failures (> ${TOLERANCE}): ${errorCount}` );
console.log( `World quaternion failures (> ${TOLERANCE}): ${worldErrorCount}` );

// ===== ANIMATION TEST =====
console.log( '\n=== ANIMATION TEST ===' );
let animErrorCount = 0;

if ( clips.length === 0 || reimClips.length === 0 ) {

	console.error( 'FAIL: No animation clips found' );
	animErrorCount ++;

} else {

	const testTimes = [ 0.0, 0.25, 0.5, 1.0, 1.5 ];

	for ( const t of testTimes ) {

		const mixerOrig = new THREE.AnimationMixer( original );
		mixerOrig.clipAction( clips[ 0 ] ).play();
		mixerOrig.update( 0 );
		mixerOrig.update( t );
		original.updateMatrixWorld( true );

		const mixerReim = new THREE.AnimationMixer( reimported );
		mixerReim.clipAction( reimClips[ 0 ] ).play();
		mixerReim.update( 0 );
		mixerReim.update( t );
		reimported.updateMatrixWorld( true );

		const origAnimBones = collectBones( original );
		const reimAnimBones = collectBones( reimported );

		let maxErr = 0, errCount = 0;

		for ( const [ name, origBone ] of origAnimBones ) {

			const reimBone = reimAnimBones.get( name );
			if ( ! reimBone ) continue;

			const dot = Math.abs( origBone.quaternion.dot( reimBone.quaternion ) );
			const err = 1 - dot;
			if ( err > maxErr ) maxErr = err;

			if ( err > TOLERANCE ) {

				errCount ++;
				if ( errCount <= 2 ) {

					console.error( `  t=${t.toFixed( 2 )} bone "${name}": quat dot=${dot.toFixed( 6 )}, error=${err.toFixed( 6 )}` );

				}

			}

		}

		console.log( `t=${t.toFixed( 2 )}: maxErr=${maxErr.toFixed( 6 )}, failures=${errCount}` );
		animErrorCount += errCount;

		mixerOrig.stopAllAction();
		mixerOrig.uncacheRoot( original );
		mixerReim.stopAllAction();
		mixerReim.uncacheRoot( reimported );

	}

}

console.log( '\n--- Animation Results ---' );
console.log( `Animation failures (> ${TOLERANCE}): ${animErrorCount}` );

// ===== FINAL RESULT =====
const totalFail = errorCount + worldErrorCount + animErrorCount;
console.log( '\n=== FINAL RESULT ===' );

if ( totalFail === 0 ) {

	console.log( 'PASS: Bind pose and animation roundtrip match within tolerance' );
	process.exit( 0 );

} else {

	console.error( `FAIL: ${totalFail} total failures` );
	process.exit( 1 );

}
