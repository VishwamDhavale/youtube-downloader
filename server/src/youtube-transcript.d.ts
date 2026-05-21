declare module 'youtube-transcript/dist/youtube-transcript.esm.js' {
  export interface TranscriptResponse {
    text: string;
    duration: number;
    offset: number;
    lang?: string;
  }

  export function fetchTranscript(
    videoId: string,
    config?: { lang?: string }
  ): Promise<TranscriptResponse[]>;
}
