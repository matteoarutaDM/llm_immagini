import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { toSpeakableText } from "../hooks/useSpeechSynthesis";
import { AnswerCard } from "./AnswerCard";

const result = {
  recognized: true,
  machine: { macchina: "Gru semovente", tipo: "Portuale" },
  vision_score: 0.9,
  answer: "**Attenzione**: spegni il motore prima di cambiare il filtro.",
};

class FakeUtterance {
  lang = "";
  voice: unknown = null;
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public text: string) {}
}

function stubSpeech() {
  let current: FakeUtterance | null = null;
  const synth = {
    speak: vi.fn((utterance: FakeUtterance) => {
      current = utterance;
    }),
    cancel: vi.fn(),
    getVoices: vi.fn(() => [
      { lang: "en-US", localService: true, name: "Alex" },
      { lang: "it-IT", localService: false, name: "Google italiano" },
      { lang: "it-IT", localService: true, name: "Alice" },
    ]),
  };
  vi.stubGlobal("SpeechSynthesisUtterance", FakeUtterance);
  Object.defineProperty(window, "speechSynthesis", { configurable: true, value: synth });
  return { synth, finish: () => current?.onend?.() };
}

afterEach(() => {
  vi.unstubAllGlobals();
  delete (window as { speechSynthesis?: unknown }).speechSynthesis;
});

describe("ascolto della risposta", () => {
  it("legge la risposta in italiano con una voce locale e torna a 'Ascolta' alla fine", async () => {
    const { synth, finish } = stubSpeech();
    const user = userEvent.setup();
    render(<AnswerCard result={result} />);

    await user.click(await screen.findByRole("button", { name: "Ascolta la risposta" }));

    const utterance = synth.speak.mock.calls[0][0] as FakeUtterance;
    expect(utterance.text).toBe("Attenzione: spegni il motore prima di cambiare il filtro.");
    expect(utterance.lang).toBe("it-IT");
    expect(utterance.voice).toMatchObject({ name: "Alice" });
    expect(screen.getByRole("button", { name: "Interrompi lettura" })).toBeInTheDocument();

    act(() => finish());
    expect(await screen.findByRole("button", { name: "Ascolta la risposta" })).toBeInTheDocument();
  });

  it("interrompe la lettura con Stop", async () => {
    const { synth } = stubSpeech();
    const user = userEvent.setup();
    render(<AnswerCard result={result} />);

    await user.click(await screen.findByRole("button", { name: "Ascolta la risposta" }));
    synth.cancel.mockClear();
    await user.click(screen.getByRole("button", { name: "Interrompi lettura" }));

    expect(synth.cancel).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Ascolta la risposta" })).toBeInTheDocument();
  });

  it("nasconde il pulsante se il browser non ha la sintesi vocale", async () => {
    render(<AnswerCard result={result} />);
    await screen.findByText(/spegni il motore/);
    expect(screen.queryByRole("button", { name: "Ascolta la risposta" })).not.toBeInTheDocument();
  });

  it("toglie la formattazione markdown dal testo da leggere", () => {
    expect(toSpeakableText("## Passi\n- Apri il **pannello**\n- Usa `chiave 10`")).toBe("Passi\nApri il pannello\nUsa chiave 10");
  });
});
