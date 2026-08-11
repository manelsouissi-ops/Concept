import importlib.util
from pathlib import Path
import unittest


MODULE_PATH = Path(__file__).with_name("document_parser_service.py")
SPEC = importlib.util.spec_from_file_location("document_parser_service", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader
SPEC.loader.exec_module(MODULE)


class EmbeddedImageCleanupTest(unittest.TestCase):
    def test_removes_payload_and_keeps_nearby_content(self):
        source = "Avant\n\n![Schéma](data:image/png;base64,aGVsbG8=)\n\nLégende utile\n\n| A | B |"
        cleaned = MODULE.remove_embedded_images(source)
        self.assertNotIn("base64", cleaned)
        self.assertIn("[Image: Schéma]", cleaned)
        self.assertIn("Légende utile", cleaned)
        self.assertIn("| A | B |", cleaned)

    def test_rejects_unrecognised_embedded_image_form(self):
        with self.assertRaises(ValueError):
            MODULE.remove_embedded_images("src=data:image/png;base64,aGVsbG8=")


if __name__ == "__main__":
    unittest.main()
