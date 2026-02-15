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

// Load the original FBX
const data = fs.readFileSync( new URL( '../test.fbx', import.meta.url ) );
const buffer = data.buffer.slice( data.byteOffset, data.byteOffset + data.byteLength );

const loader = new FBXLoader();
const original = loader.parse( buffer, '' );
original.updateMatrixWorld( true );
console.log( 'Original model loaded.' );

// Collect original bone and skinned mesh data
const originalBones = new Map();
original.traverse( obj => {

	if ( obj.isBone ) {

		originalBones.set( obj.name, {
			quaternion: obj.quaternion.clone(),
			matrixWorld: obj.matrixWorld.clone()
		} );

	}

} );

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

console.log( `Found ${originalBones.size} bones and ${originalMeshes.length} skinned meshes` );

// Export using FBXExporter
const exporter = new FBXExporter();
const blob = await exporter.parse( original, {
	exportSkin: true,
	exportMaterials: false,
	embedImages: false,
	scale: 1
} );

const exportedBuffer = await blob.arrayBuffer();
console.log( `Exported ${exportedBuffer.byteLength} bytes` );

// Re-import
const loader2 = new FBXLoader();
const reimported = loader2.parse( exportedBuffer, '' );
reimported.updateMatrixWorld( true );
console.log( 'Re-imported model loaded.' );

// Collect reimported data
const reimportedBones = new Map();
reimported.traverse( obj => {

	if ( obj.isBone ) {

		reimportedBones.set( obj.name, {
			quaternion: obj.quaternion.clone(),
			matrixWorld: obj.matrixWorld.clone()
		} );

	}

} );

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

console.log( `Re-imported: ${reimportedBones.size} bones, ${reimportedMeshes.length} skinned meshes` );

// Compare bone inverses
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

	// Compare bind matrices
	const bindMatrixDiff = compareMatrices( origMesh.bindMatrix, reimportMesh.bindMatrix );
	console.log( `  Bind matrix max element diff: ${bindMatrixDiff.toFixed( 6 )}` );
	if ( bindMatrixDiff > TOLERANCE ) {

		console.error( `  FAIL: Bind matrix difference too large: ${bindMatrixDiff}` );
		errorCount ++;

	}

	// Compare bone inverses
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

// Compare world-space bone quaternions
let worldMaxError = 0;
let worldErrorCount = 0;

for ( const [ name, origData ] of originalBones ) {

	const reimportData = reimportedBones.get( name );
	if ( ! reimportData ) continue;

	const qDot = Math.abs( origData.quaternion.dot( reimportData.quaternion ) );
	const qError = 1 - qDot;

	if ( qError > TOLERANCE ) {

		worldErrorCount ++;
		if ( worldErrorCount <= 5 ) {

			console.error( `  FAIL bone "${name}" quaternion: dot=${qDot.toFixed( 6 )}, error=${qError.toFixed( 6 )}` );
			console.log( `    Original:    ${quatToStr( origData.quaternion )}` );
			console.log( `    Re-imported: ${quatToStr( reimportData.quaternion )}` );

		}

	}

	if ( qError > worldMaxError ) worldMaxError = qError;

}

console.log( '\n=== RESULTS ===' );
console.log( `Max bone inverse error: ${maxError.toFixed( 6 )}` );
console.log( `Max world quaternion error: ${worldMaxError.toFixed( 6 )}` );
console.log( `Bone inverse failures (> ${TOLERANCE}): ${errorCount}` );
console.log( `World quaternion failures (> ${TOLERANCE}): ${worldErrorCount}` );

if ( errorCount === 0 && worldErrorCount === 0 ) {

	console.log( 'PASS: All bone transforms match within tolerance' );
	process.exit( 0 );

} else {

	console.error( 'FAIL: Some bone transforms do not match' );
	process.exit( 1 );

}
