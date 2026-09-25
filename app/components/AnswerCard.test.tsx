import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { splitForSpeech, toSpeakableText } from "../hooks/useReadAloud";
import { AnswerCard } from "./AnswerCard";

const result = {
  recognized: true,
  machine: { macchina: "Gru semovente", tipo: "Portuale" },
  vision_score: 0.9,
  answer: "**Attenzione**: spegni il motore prima di cambiare il filtro.",
};

function wavResponse(): Response {
  return { ok: true, status: 200, blob: async () => new Blob(["RIFF"], { type: "audio/wav" }) } as Response;
}

let playing: HTMLAudioElement[] = [];

beforeEach(() => {
  playing = [];
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(function (this: HTMLMediaElement) {
    playing.push(this);
    return Promise.resolve();
  });
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  // jsdom has no object URLs: define them so they can be spied on.
  URL.createObjectURL ??= () => "";
  URL.revokeObjectURL ??= () => {};
  vi.spyOn(URL, "createObjectURL").mockImplementation(() => `blob:chunk-${Math.random()}`);
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
});

afterEach(() => {
  // Unmount first: it pauses the audio, which jsdom only supports while mocked.
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** Ends the chunk that is playing, as the browser does when the audio finishes. */
function endCurrentChunk() {
  act(() => {
    playing[playing.length - 1].onended?.(new Event("ended"));
  });
}

describe("ascolto della risposta", () => {
  it("chiede l'audio al backend col token e torna a 'Ascolta' alla fine", async () => {
    const fetchMock = vi.fn(async () => wavResponse());
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<AnswerCard result={result} token="fake-token" />);

    await user.click(screen.getByRole("button", { name: "Ascolta la risposta" }));

    await waitFor(() => expect(screen.getByText("Stop")).toBeInTheDocument());
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/backend/speak");
    expect(init.headers).toEqual({ Authorization: "Bearer fake-token" });
    expect((init.body as FormData).get("text")).toBe("Attenzione: spegni il motore prima di cambiare il filtro.");

    endCurrentChunk();
    expect(await screen.findByRole("button", { name: "Ascolta la risposta" })).toBeInTheDocument();
  });

  it("legge le risposte lunghe un pezzo alla volta", async () => {
    const fetchMock = vi.fn(async () => wavResponse());
    vi.stubGlobal("fetch", fetchMock);
    const long = { ...result, answer: `${"Prima frase del primo passo. ".repeat(10)}\n${"Seconda parte della procedura. ".repeat(10)}` };
    const user = userEvent.setup();
    render(<AnswerCard result={long} token="fake-token" />);

    await user.click(screen.getByRole("button", { name: "Ascolta la risposta" }));
    await waitFor(() => expect(screen.getByText("Stop")).toBeInTheDocument());
    // The second chunk is fetched while the first one plays.
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    endCurrentChunk();
    await waitFor(() => expect(playing.filter((audio) => audio.src.startsWith("blob:")).length).toBe(2));
    endCurrentChunk();
    expect(await screen.findByRole("button", { name: "Ascolta la risposta" })).toBeInTheDocument();
  });

  it("interrompe la lettura con Stop", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => wavResponse()));
    const user = userEvent.setup();
    render(<AnswerCard result={result} token="fake-token" />);

    await user.click(screen.getByRole("button", { name: "Ascolta la risposta" }));
    await user.click(await screen.findByRole("button", { name: "Interrompi lettura" }));

    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Ascolta la risposta" })).toBeInTheDocument();
  });

  it("mostra l'errore del backend", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 500, json: async () => ({ detail: "Lettura non riuscita. Riprova." }) }) as Response),
    );
    const user = userEvent.setup();
    render(<AnswerCard result={result} token="fake-token" />);

    await user.click(screen.getByRole("button", { name: "Ascolta la risposta" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Lettura non riuscita. Riprova.");
    expect(screen.getByRole("button", { name: "Ascolta la risposta" })).toBeInTheDocument();
  });
});

describe("preparazione del testo da leggere", () => {
  it("toglie la formattazione markdown", () => {
    expect(toSpeakableText("## Passi\n- Apri il **pannello**\n- Usa `chiave 10`")).toBe("Passi\nApri il pannello\nUsa chiave 10");
  });

  it("divide su frasi senza superare la lunghezza massima", () => {
    expect(splitForSpeech("Uno. Due.\nTre quattro cinque sei.", 12)).toEqual(["Uno. Due.", "Tre quattro", "cinque sei."]);
    expect(splitForSpeech("  \n ")).toEqual([]);
  });
});
