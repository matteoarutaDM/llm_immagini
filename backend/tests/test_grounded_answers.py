import json
from unittest.mock import Mock

import pytest
import torch

from backend import model_service as service


MACHINE = {"id": "crane", "macchina": "Gru", "tipo": "portuale", "manuali": ["gru.pdf"]}
QUOTE = "Controllare il livello dell'olio prima dell'avviamento."
HITS = [{"source": "gru.pdf", "page": 42, "text": QUOTE}]


def test_unrecognized_image_stops_before_ocr_retrieval_and_llm(monkeypatch):
    assistant = service.MachineAssistant()
    monkeypatch.setattr(assistant, "ensure_ready", Mock())
    assistant.machines_list = [MACHINE]
    assistant.reference_embeddings = {"crane": [{"path": "ref.jpg", "embedding": torch.tensor([1., 0.])}]}
    monkeypatch.setattr(assistant, "_image_embedding", lambda path: torch.tensor([0., 1.]))
    monkeypatch.setattr(service, "IMAGE_RECOGNITION_THRESHOLD", 0.73)
    for name in ("extract_image_identifiers", "retrieve", "call_llm"):
        monkeypatch.setattr(assistant, name, Mock(side_effect=AssertionError("Must not be called")))
    with pytest.raises(ValueError, match="non riconosciuta"):
        assistant.ask_machine("unknown.jpg", "È una pompa?")
    assistant.extract_image_identifiers.assert_not_called()
    assistant.retrieve.assert_not_called()
    assistant.call_llm.assert_not_called()


def test_no_passages_does_not_call_llm(monkeypatch):
    assistant = service.MachineAssistant()
    monkeypatch.setattr(assistant, "call_llm", Mock(side_effect=AssertionError("Must not be called")))
    assert "informazioni sufficienti" in assistant.answer_from_manuals("Controlli?", MACHINE, [])


def test_answer_uses_verified_pdf_source_and_page(monkeypatch):
    assistant = service.MachineAssistant()
    llm = Mock(return_value=json.dumps({"points": [{"text": "Verifica il livello dell'olio prima di avviare.", "passage_id": 1, "quote": QUOTE}]}))
    monkeypatch.setattr(assistant, "call_llm", llm)
    answer = assistant.answer_from_manuals("Controlli?", MACHINE, HITS)
    assert "gru.pdf, pagina 42" in answer
    assert QUOTE in answer
    assert QUOTE in llm.call_args.args[0]


def test_quote_with_typographic_apostrophe_is_still_verified(monkeypatch):
    assistant = service.MachineAssistant()
    quote = QUOTE.replace("'", "\u2019")
    monkeypatch.setattr(assistant, "call_llm", lambda prompt: json.dumps({"points": [{"text": "Verifica l'olio.", "passage_id": 1, "quote": quote}]}))
    assert "gru.pdf, pagina 42" in assistant.answer_from_manuals("Controlli?", MACHINE, HITS)


def test_answer_in_chosen_language_translates_text_but_keeps_original_quote(monkeypatch):
    assistant = service.MachineAssistant()
    llm = Mock(side_effect=[
        json.dumps({"points": [{"text": "Verifica il livello dell'olio prima di avviare.", "passage_id": 1, "quote": QUOTE}]}),
        json.dumps({"translations": ["Check the oil level before starting."]}),
    ])
    monkeypatch.setattr(assistant, "call_llm", llm)
    answer = assistant.answer_from_manuals("Checks?", MACHINE, HITS, "en")
    # Generated and verified in Italian, then only the explanation is translated.
    assert "Rispondi in italiano" in llm.call_args_list[0].args[0]
    assert "into English" in llm.call_args_list[1].args[0]
    assert QUOTE not in llm.call_args_list[1].args[0]
    assert answer == f"• Check the oil level before starting.\n  Source: gru.pdf, page 42.\n  Excerpt: «{QUOTE}»"


@pytest.mark.parametrize("translation", ["not json", '{"translations": []}', '{"translations": [""]}'])
def test_unusable_translation_keeps_verified_italian_text(monkeypatch, translation):
    assistant = service.MachineAssistant()
    llm = Mock(side_effect=[
        json.dumps({"points": [{"text": "Verifica il livello dell'olio.", "passage_id": 1, "quote": QUOTE}]}),
        translation,
    ])
    monkeypatch.setattr(assistant, "call_llm", llm)
    answer = assistant.answer_from_manuals("Fragen?", MACHINE, HITS, "de")
    assert "Verifica il livello dell'olio." in answer
    assert "Quelle: gru.pdf, Seite 42." in answer


def test_italian_answer_needs_no_translation_call(monkeypatch):
    assistant = service.MachineAssistant()
    llm = Mock(return_value=json.dumps({"points": [{"text": "Verifica l'olio.", "passage_id": 1, "quote": QUOTE}]}))
    monkeypatch.setattr(assistant, "call_llm", llm)
    assistant.answer_from_manuals("Controlli?", MACHINE, HITS)
    assert llm.call_count == 1


def test_fallback_is_in_chosen_language(monkeypatch):
    assistant = service.MachineAssistant()
    monkeypatch.setattr(assistant, "call_llm", lambda prompt: '{"points": []}')
    assert assistant.answer_from_manuals("Fragen?", MACHINE, HITS, "de") == service.ANSWER_LANGUAGES["de"]["fallback"]


def test_api_and_service_accept_the_same_languages():
    from backend import main

    assert set(main.ANSWER_LANGUAGE_CODES) == set(service.ANSWER_LANGUAGES)


@pytest.mark.parametrize("response", [
    "L'oggetto è una pompa idraulica. Controlla che funzioni.",
    '{"points": []}',
    '{"points": [{"text": "Inventa un controllo", "passage_id": 1, "quote": "Questa frase non compare nel manuale."}]}',
    '{"points": [{"text": "Controlla olio", "passage_id": 99, "quote": "Controllare il livello dell’olio."}]}',
    '[]',
])
def test_unsupported_answers_are_not_published(monkeypatch, response):
    assistant = service.MachineAssistant()
    monkeypatch.setattr(assistant, "call_llm", lambda prompt: response)
    assert "informazioni sufficienti" in assistant.answer_from_manuals("Controlli?", MACHINE, HITS)


def test_recognized_machine_retrieval_is_limited_to_its_manuals():
    assistant = service.MachineAssistant()
    assistant.machines = {"crane": MACHINE}
    assistant.rag = Mock()
    assistant.rag.retrieve.return_value = HITS
    assert assistant.retrieve("Gru controlli", "crane", 5) == HITS
    assistant.rag.retrieve.assert_called_once_with("Gru controlli", top_k=5, document_ids=["gru.pdf"])
