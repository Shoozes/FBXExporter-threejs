import { createServer } from 'http';
import { readFile } from 'fs/promises';
import { resolve, extname } from 'path';
import { fileURLToPath } from 'url';
import puppeteer from 'puppeteer-core';

const PROJECT_ROOT = resolve( fileURLToPath( import.meta.url ), '..', '..' );
const SCREENSHOT_PATH = resolve( fileURLToPath( import.meta.url ), '..', 'roundtrip_screenshot.png' );

const CHROMIUM_PATH = process.env.CHROMIUM_PATH || '/usr/bin/chromium-browser';

// Delay for SwiftShader WebGL render to flush
const RENDER_SETTLE_MS = 500;

const MIME = {
	'.html': 'text/html',
	'.js':   'application/javascript',
	'.mjs':  'application/javascript',
	'.css':  'text/css',
	'.json': 'application/json',
	'.fbx':  'application/octet-stream',
	'.png':  'image/png',
	'.jpg':  'image/jpeg',
};

// Simple static file server rooted at the project directory
const server = createServer( async ( req, res ) => {

	const urlPath = decodeURIComponent( req.url.split( '?' )[ 0 ] );
	const filePath = resolve( PROJECT_ROOT, '.' + urlPath );

	// Prevent path traversal
	if ( ! filePath.startsWith( PROJECT_ROOT ) ) {

		res.writeHead( 403 );
		res.end( 'Forbidden' );
		return;

	}

	try {

		const data = await readFile( filePath );
		const ext = extname( filePath ).toLowerCase();
		res.writeHead( 200, { 'Content-Type': MIME[ ext ] || 'application/octet-stream' } );
		res.end( data );

	} catch {

		res.writeHead( 404 );
		res.end( 'Not found' );

	}

} );

await new Promise( ( resolve ) => server.listen( 0, '127.0.0.1', resolve ) );
const port = server.address().port;
console.log( `Server listening on http://127.0.0.1:${port}` );

let browser;
try {

	browser = await puppeteer.launch( {
		executablePath: CHROMIUM_PATH,
		headless: 'new',
		args: [
			'--no-sandbox',
			'--disable-setuid-sandbox',
			'--use-gl=angle',
			'--use-angle=swiftshader-webgl',
			'--enable-webgl',
			'--enable-unsafe-swiftshader',
			'--ignore-gpu-blocklist',
		],
	} );

	const page = await browser.newPage();
	await page.setViewport( { width: 1280, height: 720 } );

	page.on( 'console', ( msg ) => console.log( 'PAGE:', msg.text() ) );
	page.on( 'pageerror', ( err ) => console.error( 'PAGE ERROR:', err.message ) );

	console.log( 'Navigating to visual test…' );
	await page.goto( `http://127.0.0.1:${port}/test/visual_test.html`, {
		waitUntil: 'networkidle0',
		timeout: 60000,
	} );

	// Wait for the test to signal completion
	await page.waitForFunction( '!!window.__testComplete', { timeout: 60000 } );

	// Delay to ensure final render is flushed in software WebGL
	await new Promise( ( r ) => setTimeout( r, RENDER_SETTLE_MS ) );

	await page.screenshot( { path: SCREENSHOT_PATH, fullPage: false } );
	console.log( `Screenshot saved to ${SCREENSHOT_PATH}` );

	const status = await page.evaluate( () => document.getElementById( 'status' ).textContent );
	console.log( `Test status: ${status}` );

	if ( ! status.startsWith( 'PASS' ) ) {

		process.exitCode = 1;

	}

} finally {

	if ( browser ) await browser.close();
	server.close();

}
