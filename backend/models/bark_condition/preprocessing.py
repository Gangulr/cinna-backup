from PIL import Image, ImageOps
import numpy as np

IMAGE_SIZE = 224

def preprocess_bark_image(path_or_file):
    with Image.open(path_or_file) as image:
        image = ImageOps.exif_transpose(image).convert("RGB")
        image = image.resize((IMAGE_SIZE, IMAGE_SIZE), Image.Resampling.BILINEAR)
        array = np.asarray(image, dtype=np.float32)
    return np.expand_dims(array, axis=0)
