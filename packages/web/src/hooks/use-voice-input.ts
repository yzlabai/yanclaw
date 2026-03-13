import { useCallback, useRef, useState } from "react";
import { API_BASE, apiFetch, uploadMedia } from "../lib/api";

interface UseVoiceInputReturn {
	isRecording: boolean;
	isTranscribing: boolean;
	startRecording: () => Promise<void>;
	stopRecording: () => Promise<string>;
	cancelRecording: () => void;
}

function getRecorderMimeType(): string | undefined {
	if (typeof MediaRecorder === "undefined") return undefined;
	if (MediaRecorder.isTypeSupported("audio/webm")) return "audio/webm";
	if (MediaRecorder.isTypeSupported("audio/mp4")) return "audio/mp4";
	return undefined;
}

export function useVoiceInput(): UseVoiceInputReturn {
	const [isRecording, setIsRecording] = useState(false);
	const [isTranscribing, setIsTranscribing] = useState(false);
	const recorderRef = useRef<MediaRecorder | null>(null);
	const chunksRef = useRef<Blob[]>([]);
	const resolveRef = useRef<((text: string) => void) | null>(null);
	const rejectRef = useRef<((err: Error) => void) | null>(null);

	const startRecording = useCallback(async () => {
		const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
		const mimeType = getRecorderMimeType();
		const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
		chunksRef.current = [];

		recorder.ondataavailable = (e) => {
			if (e.data.size > 0) chunksRef.current.push(e.data);
		};

		recorder.start();
		recorderRef.current = recorder;
		setIsRecording(true);
	}, []);

	const stopRecording = useCallback(async (): Promise<string> => {
		const recorder = recorderRef.current;
		if (!recorder || recorder.state === "inactive") {
			return "";
		}

		return new Promise<string>((resolve, reject) => {
			resolveRef.current = resolve;
			rejectRef.current = reject;

			recorder.onstop = async () => {
				// Stop all tracks to release the microphone
				for (const track of recorder.stream.getTracks()) {
					track.stop();
				}

				setIsRecording(false);
				setIsTranscribing(true);

				try {
					const actualMime = recorder.mimeType || "audio/webm";
					const ext = actualMime.includes("mp4") ? "mp4" : "webm";
					const blob = new Blob(chunksRef.current, { type: actualMime });
					const file = new File([blob], `voice.${ext}`, { type: actualMime });
					const { id: mediaId } = await uploadMedia(file);

					const res = await apiFetch(`${API_BASE}/api/stt/transcribe`, {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({ mediaId }),
					});

					if (!res.ok) {
						const data = (await res.json()) as { error?: string };
						throw new Error(data.error ?? "Transcription failed");
					}

					const { text } = (await res.json()) as { text: string };
					resolveRef.current?.(text);
				} catch (err) {
					rejectRef.current?.(err instanceof Error ? err : new Error(String(err)));
				} finally {
					setIsTranscribing(false);
					recorderRef.current = null;
				}
			};

			recorder.stop();
		});
	}, []);

	const cancelRecording = useCallback(() => {
		const recorder = recorderRef.current;
		if (recorder && recorder.state !== "inactive") {
			recorder.onstop = () => {
				for (const track of recorder.stream.getTracks()) {
					track.stop();
				}
			};
			recorder.stop();
		}
		recorderRef.current = null;
		chunksRef.current = [];
		setIsRecording(false);
		setIsTranscribing(false);
	}, []);

	return { isRecording, isTranscribing, startRecording, stopRecording, cancelRecording };
}
