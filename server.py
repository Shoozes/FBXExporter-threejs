import os
from flask import Flask, request, send_from_directory, jsonify

app = Flask(__name__, static_folder=None)

UPLOAD_FOLDER = 'uploads'
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

@app.route('/')
def root():
    return send_from_directory('examples', 'misc_exporter_fbx.html')

@app.route('/favicon.ico')
def favicon():
    return '', 204

@app.route('/<path:path>')
def serve_static(path):
    return send_from_directory('.', path)

@app.route('/upload-fbx', methods=['POST'])
def upload_fbx():
    if 'file' not in request.files:
        return jsonify({'error': 'No file part'}), 400
        
    file = request.files['file']
    
    if file.filename == '':
        return jsonify({'error': 'No selected file'}), 400
        
    if file:
        # Basic sanitization could go here, but strictly speaking 
        # meant for local testing so standard save is fine.
        filepath = os.path.join(UPLOAD_FOLDER, file.filename)
        file.save(filepath)
        size_kb = os.path.getsize(filepath) / 1024
        print(f"Received FBX: {file.filename} ({size_kb:.2f} KB)")
        
        return jsonify({
            'message': 'File uploaded',
            'filename': file.filename,
            'size_kb': size_kb,
            'path': filepath
        }), 200

if __name__ == '__main__':
    print("Server running at http://localhost:5000")
    app.run(debug=True, port=5000)