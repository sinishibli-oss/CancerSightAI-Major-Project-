import json
import os


import uuid
from pathlib import Path

import cv2
import numpy as np
import tensorflow as tf
from flask import Flask, flash, redirect, render_template, request, url_for
from PIL import Image, UnidentifiedImageError
from tensorflow.keras.applications.mobilenet_v2 import preprocess_input
from werkzeug.utils import secure_filename

BASE_DIR = Path(__file__).resolve().parent
MODEL_PATH = BASE_DIR / "models" / "mobilenetv2_best_legacy.h5"
CLASS_INDEX_PATH = BASE_DIR / "models" / "class_indices.json"
UPLOAD_DIR = BASE_DIR / "static" / "uploads"
GRADCAM_DIR = BASE_DIR / "static" / "gradcam"

UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
GRADCAM_DIR.mkdir(parents=True, exist_ok=True)

app = Flask(__name__)
app.secret_key = os.environ.get("SECRET_KEY", "cancersight-demo-key-change-in-production")
app.config["MAX_CONTENT_LENGTH"] = 10 * 1024 * 1024

ALLOWED_EXTENSIONS = {"jpg", "jpeg", "png", "tif", "tiff", "webp"}

CLASS_LABELS = {
    "colon_aca": "Colon Adenocarcinoma",
    "colon_n": "Colon Normal Tissue",
    "idc_negative": "Breast IDC Negative",
    "idc_positive": "Breast IDC Positive",
    "lung_aca": "Lung Adenocarcinoma",
    "lung_n": "Lung Normal Tissue",
    "lung_scc": "Lung Squamous Cell Carcinoma",
}

with CLASS_INDEX_PATH.open("r", encoding="utf-8") as file:
    class_indices = json.load(file)
CLASS_NAMES = [name for name, _ in sorted(class_indices.items(), key=lambda item: item[1])]

model = tf.keras.models.load_model(MODEL_PATH, compile=False)


def allowed_file(filename: str) -> bool:
    return "." in filename and filename.rsplit(".", 1)[1].lower() in ALLOWED_EXTENSIONS


def find_last_conv_layer(keras_model: tf.keras.Model) -> str:
    preferred = "block_16_project_BN"
    try:
        keras_model.get_layer(preferred)
        return preferred
    except ValueError:
        pass

    for layer in reversed(keras_model.layers):
        output_shape = getattr(layer, "output_shape", None)
        if output_shape is not None and len(output_shape) == 4:
            return layer.name
    raise RuntimeError("No suitable convolutional layer was found for Grad-CAM.")


def create_gradcam(keras_model: tf.keras.Model, image_batch: np.ndarray) -> np.ndarray:
    layer_name = find_last_conv_layer(keras_model)
    grad_model = tf.keras.models.Model(
        keras_model.inputs,
        [keras_model.get_layer(layer_name).output, keras_model.output],
    )

    with tf.GradientTape() as tape:
        conv_output, predictions = grad_model(image_batch, training=False)
        predicted_index = tf.argmax(predictions[0])
        class_score = predictions[:, predicted_index]

    gradients = tape.gradient(class_score, conv_output)
    pooled_gradients = tf.reduce_mean(gradients, axis=(0, 1, 2))
    heatmap = tf.reduce_sum(conv_output[0] * pooled_gradients, axis=-1)
    heatmap = tf.maximum(heatmap, 0)
    maximum = tf.reduce_max(heatmap)
    heatmap = tf.where(maximum > 0, heatmap / maximum, heatmap)
    return heatmap.numpy()


@app.errorhandler(413)
def file_too_large(_error):
    flash("The selected image is larger than 10 MB.")
    return redirect(url_for("index"))


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/predict", methods=["POST"])
def predict():
    if "image" not in request.files:
        flash("Choose a histopathology image before running the analysis.")
        return redirect(url_for("index"))

    uploaded_file = request.files["image"]
    if uploaded_file.filename == "":
        flash("Choose a histopathology image before running the analysis.")
        return redirect(url_for("index"))

    if not allowed_file(uploaded_file.filename):
        flash("Choose a JPEG, PNG, TIFF, or WEBP image.")
        return redirect(url_for("index"))

    extension = uploaded_file.filename.rsplit(".", 1)[1].lower()
    safe_stem = Path(secure_filename(uploaded_file.filename)).stem or "image"
    unique_name = f"{safe_stem}_{uuid.uuid4().hex[:10]}.{extension}"
    upload_path = UPLOAD_DIR / unique_name

    try:
        uploaded_file.save(upload_path)
        with Image.open(upload_path) as image:
            image.verify()
        with Image.open(upload_path) as image:
            original = image.convert("RGB")
    except (UnidentifiedImageError, OSError, ValueError):
        upload_path.unlink(missing_ok=True)
        flash("The uploaded file could not be read as an image.")
        return redirect(url_for("index"))

    resized = original.resize((160, 160))
    rgb_array = np.asarray(resized, dtype=np.float32)
    model_input = np.expand_dims(preprocess_input(rgb_array.copy()), axis=0)

    probabilities = model.predict(model_input, verbose=0)[0]
    predicted_index = int(np.argmax(probabilities))
    predicted_class = CLASS_NAMES[predicted_index]
    confidence = float(probabilities[predicted_index] * 100)

    try:
        heatmap = create_gradcam(model, model_input)
        heatmap = cv2.resize(heatmap, original.size)
        heatmap_color = cv2.applyColorMap(np.uint8(255 * heatmap), cv2.COLORMAP_JET)
        heatmap_color = cv2.cvtColor(heatmap_color, cv2.COLOR_BGR2RGB)
        original_array = np.asarray(original, dtype=np.uint8)
        overlay = cv2.addWeighted(original_array, 0.60, heatmap_color, 0.40, 0)

        gradcam_name = f"gradcam_{Path(unique_name).stem}.jpg"
        gradcam_path = GRADCAM_DIR / gradcam_name
        Image.fromarray(overlay).save(gradcam_path, quality=92)
    except Exception as error:
        app.logger.exception("Grad-CAM generation failed: %s", error)
        flash("Prediction succeeded, but the Grad-CAM image could not be generated.")
        return redirect(url_for("index"))

    return render_template(
        "result.html",
        prediction=CLASS_LABELS.get(predicted_class, predicted_class),
        confidence=confidence,
        uploaded_image=f"uploads/{unique_name}",
        gradcam_image=f"gradcam/{gradcam_name}",
    )


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", "5000")), debug=False)
