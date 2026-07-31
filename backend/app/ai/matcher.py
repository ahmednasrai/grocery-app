import logging
from pathlib import Path

import cv2
import numpy as np

logger = logging.getLogger(__name__)

MIN_MATCH_CONFIDENCE = 0.32


def _decode_image(image_bytes: bytes):
    nparr = np.frombuffer(image_bytes, np.uint8)
    return cv2.imdecode(nparr, cv2.IMREAD_COLOR)


def _resolve_image_path(url_or_path: str, upload_dir: Path) -> Path | None:
    if not url_or_path:
        return None
    cleaned = url_or_path.strip()
    if cleaned.startswith("/uploads/"):
        return upload_dir / cleaned.removeprefix("/uploads/")
    if cleaned.startswith("uploads/"):
        return upload_dir / cleaned.removeprefix("uploads/")
    path = Path(cleaned)
    if path.is_file():
        return path
    return upload_dir / Path(cleaned).name


def _compare_histograms(img1, img2) -> float:
    img1 = cv2.resize(img1, (256, 256))
    img2 = cv2.resize(img2, (256, 256))
    hsv1 = cv2.cvtColor(img1, cv2.COLOR_BGR2HSV)
    hsv2 = cv2.cvtColor(img2, cv2.COLOR_BGR2HSV)
    hist1 = cv2.calcHist([hsv1], [0, 1], None, [50, 60], [0, 180, 0, 256])
    hist2 = cv2.calcHist([hsv2], [0, 1], None, [50, 60], [0, 180, 0, 256])
    cv2.normalize(hist1, hist1)
    cv2.normalize(hist2, hist2)
    return float(cv2.compareHist(hist1, hist2, cv2.HISTCMP_CORREL))


def _compare_orb(img1, img2) -> float:
    orb = cv2.ORB_create(nfeatures=800)
    kp1, des1 = orb.detectAndCompute(img1, None)
    kp2, des2 = orb.detectAndCompute(img2, None)
    if des1 is None or des2 is None or len(kp1) < 4 or len(kp2) < 4:
        return 0.0

    bf = cv2.BFMatcher(cv2.NORM_HAMMING, crossCheck=True)
    matches = bf.match(des1, des2)
    if not matches:
        return 0.0

    good = [match for match in matches if match.distance < 55]
    return min(len(good) / max(len(kp1), len(kp2), 1), 1.0)


def _similarity(img1, img2) -> float:
    if img1 is None or img2 is None:
        return 0.0
    hist_score = max(_compare_histograms(img1, img2), 0.0)
    orb_score = _compare_orb(img1, img2)
    return (0.35 * hist_score) + (0.65 * orb_score)


def _product_gallery(product: dict) -> list[str]:
    gallery = list(product.get("ai_images") or [])
    image_url = product.get("image_url")
    if image_url and image_url not in gallery:
        gallery.insert(0, image_url)
    return gallery


def identify_product_from_image(query_bytes: bytes, products: list[dict], upload_dir: Path):
    query = _decode_image(query_bytes)
    if query is None:
        return None, "تعذر قراءة الصورة"

    best_product = None
    best_score = 0.0
    best_reference = None

    for product in products:
        for image_ref in _product_gallery(product):
            ref_path = _resolve_image_path(image_ref, upload_dir)
            if ref_path is None or not ref_path.exists():
                continue
            reference = cv2.imread(str(ref_path))
            score = _similarity(query, reference)
            if score > best_score:
                best_score = score
                best_product = product
                best_reference = image_ref

    if best_product is None or best_score < MIN_MATCH_CONFIDENCE:
        return None, "لم يتم التعرف على المنتج. أضف صور تدريب أوضح من المخزون."

    return {
        "product": best_product,
        "confidence": round(best_score, 3),
        "matched_reference": best_reference,
    }, None
