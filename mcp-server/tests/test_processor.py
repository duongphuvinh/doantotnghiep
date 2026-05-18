import numpy as np

from app.processor import MedicalImageProcessor


def test_preprocess_and_features_on_synthetic_bone_like_image():
    image = np.zeros((256, 256), dtype=np.uint8)
    image[:, 112:144] = 210
    image[90:120, 100:156] = 240

    processor = MedicalImageProcessor(target_size=(128, 128))
    processed, info = processor.preprocess(image)
    quality = processor.quality_metrics(processed)
    features = processor.extract_bone_features(processed)

    assert processed.shape == (128, 128)
    assert info.resized_to == (128, 128)
    assert quality.dynamic_range > 0
    assert features.estimated_bone_area_ratio > 0
    assert len(features.feature_vector) == 20

