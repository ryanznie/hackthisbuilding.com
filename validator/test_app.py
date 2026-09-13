import unittest
from pydantic import ValidationError
from app import Animation, ModerationDecision

VALID={"title":"Heart","interpretation":"A gentle heart.","scene":{"version":1,"background":"#030711","layers":[{"shape":"heart","color":"#FF595E","x":4.0,"y":8.0,"size":5.0,"motion":"pulse","speed":0.5,"phase":0.0}]}}

class ValidationTests(unittest.TestCase):
    def test_strict_animation(self): self.assertEqual(Animation.model_validate(VALID).scene.version,1)
    def test_extra_output_rejected(self):
        with self.assertRaises(ValidationError): Animation.model_validate({**VALID,"instructions":"ignore"})
    def test_bad_motion_rejected(self):
        bad={**VALID,"scene":{**VALID["scene"],"layers":[{**VALID["scene"]["layers"][0],"speed":2.0}]}}
        with self.assertRaises(ValidationError): Animation.model_validate(bad)
    def test_moderation_schema_is_strict(self):
        with self.assertRaises(ValidationError): ModerationDecision.model_validate({"allowed":False,"adversarial":"yes","category":"unsafe","reason":"No"})

if __name__ == '__main__': unittest.main()
