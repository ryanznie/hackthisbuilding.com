import io
import json
import unittest
from unittest.mock import Mock, patch
from pydantic import ValidationError
from app import Animation, Handler, ModerationDecision, call_model

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

    def test_field_validator_failure_returns_serializable_422_without_raw_input(self):
        # Exercise the real HTTP handler and reply serializer without opening a socket.
        for field in ("title", "interpretation"):
            body = json.dumps({**VALID, field: "https://private.example/rejected"}).encode()
            handler = Handler.__new__(Handler)
            handler.path = "/validate-animation"
            handler.headers = {"Content-Length": str(len(body))}
            handler.rfile = io.BytesIO(body)
            handler.wfile = io.BytesIO()
            handler.send_response = Mock()
            handler.send_header = Mock()
            handler.end_headers = Mock()
            with patch.dict("os.environ", {"VALIDATOR_TOKEN": ""}):
                handler.do_POST()
            handler.send_response.assert_called_once_with(422)
            response = json.loads(handler.wfile.getvalue())
            self.assertEqual(response["error"], "schema_invalid")
            self.assertEqual(response["details"][0]["loc"], [field])
            self.assertNotIn("ctx", response["details"][0])
            self.assertNotIn("input", response["details"][0])
            self.assertNotIn("private.example", handler.wfile.getvalue().decode())

    def test_python_owns_exactly_three_moderation_attempts(self):
        with patch.dict("os.environ", {"OPENROUTER_API_KEY": "test-key"}), \
             patch("app.urllib.request.urlopen", side_effect=TimeoutError("test timeout")) as request, \
             patch("app.time.sleep") as sleep:
            with self.assertRaisesRegex(RuntimeError, "moderation_failed"):
                call_model("A sunset")
        self.assertEqual(request.call_count, 3)
        self.assertTrue(all(call.kwargs["timeout"] == 20 for call in request.call_args_list))
        self.assertEqual([call.args[0] for call in sleep.call_args_list], [.25, .5])

    def test_python_can_recover_on_its_third_moderation_attempt(self):
        decision = {"allowed": True, "adversarial": False, "category": "allowed", "reason": "Allowed"}
        response = io.BytesIO(json.dumps({"choices": [{"message": {"content": json.dumps(decision)}}]}).encode())
        with patch.dict("os.environ", {"OPENROUTER_API_KEY": "test-key"}), \
             patch("app.urllib.request.urlopen", side_effect=[TimeoutError(), TimeoutError(), response]) as request, \
             patch("app.time.sleep"):
            self.assertEqual(call_model("A sunset").model_dump(), decision)
        self.assertEqual(request.call_count, 3)

if __name__ == '__main__': unittest.main()
