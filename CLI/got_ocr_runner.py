from __future__ import annotations

import argparse
import json
import sys

import torch
from PIL import Image
from transformers import AutoModelForImageTextToText, AutoProcessor


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("image_path")
    parser.add_argument("--model", default="stepfun-ai/GOT-OCR-2.0-hf")
    parser.add_argument("--device", default="cpu")
    parser.add_argument("--local-files-only", action="store_true")
    parser.add_argument("--max-new-tokens", type=int, default=512)
    args = parser.parse_args()

    try:
        processor = AutoProcessor.from_pretrained(
            args.model,
            local_files_only=args.local_files_only,
        )
        dtype = torch.float16 if args.device == "cuda" else torch.float32
        model = AutoModelForImageTextToText.from_pretrained(
            args.model,
            dtype=dtype,
            local_files_only=args.local_files_only,
        ).to(args.device)
        model.eval()

        image = Image.open(args.image_path).convert("RGB")
        inputs = processor(image, return_tensors="pt").to(args.device)
        with torch.no_grad():
            generated_ids = model.generate(
                **inputs,
                do_sample=False,
                tokenizer=processor.tokenizer,
                stop_strings="<|im_end|>",
                max_new_tokens=args.max_new_tokens,
            )
        text = processor.decode(
            generated_ids[0, inputs["input_ids"].shape[1] :],
            skip_special_tokens=True,
            clean_up_tokenization_spaces=False,
        ).strip()
        print(json.dumps({"ok": True, "text": text}, ensure_ascii=False))
        return 0
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
