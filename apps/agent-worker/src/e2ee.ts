import {
  AudioStream,
  type E2EEOptions,
  EncryptionType,
  ParticipantKind,
  type RemoteParticipant,
  type RemoteTrack,
  type RemoteTrackPublication,
  type Room,
  RoomEvent,
  TrackKind,
} from '@livekit/rtc-node'
import { createLogger } from '@monibot/logger'
import { DecryptionWatchdog } from './decryption-watchdog'

const logger = createLogger('E2ee')

/** Silence long enough to rule out a pause between words, short enough to flag a bad key early. */
const DECRYPTION_SILENCE_WINDOW_MS = 5000

/**
 * Element Call's shared-key mode (livekit-client `ExternalE2EEKeyProvider`): the call link's
 * `password` as UTF-8 key material, PBKDF2 with salt `LKFrameEncryptionKey`, AES-GCM frames.
 * These match rtc-node's defaults, which rtc-node 1.1.0 does not export, so they are spelled out;
 * verified against Element Call in both directions.
 */
export function sharedKeyE2eeOptions(sharedKey: string): E2EEOptions {
  return {
    keyProviderOptions: {
      sharedKey: new TextEncoder().encode(sharedKey),
      ratchetSalt: new TextEncoder().encode('LKFrameEncryptionKey'),
      ratchetWindowSize: 16,
      failureTolerance: -1,
      keyRingSize: 16,
      // KeyDerivationFunction.PBKDF2 (enum lives in @livekit/rtc-ffi-bindings, not a direct dependency).
      keyDerivationFunction: 0,
    },
    encryptionType: EncryptionType.GCM,
  }
}

async function watchTrack(
  track: RemoteTrack,
  publication: RemoteTrackPublication,
  context: { sessionId: string; e2eeEnabled: boolean }
) {
  const watchdog = new DecryptionWatchdog({ windowMs: DECRYPTION_SILENCE_WINDOW_MS })
  for await (const frame of new AudioStream(track)) {
    const verdict = watchdog.observe({
      samples: frame.data,
      atMs: Date.now(),
      muted: publication.muted ?? false,
    })
    if (verdict === 'suspected') {
      logger.error('Student audio is digital silence on an unmuted track: E2EE key mismatch?', {
        ...context,
        silenceMs: DECRYPTION_SILENCE_WINDOW_MS,
      })
    } else if (verdict === 'recovered') {
      logger.info('Student audio decodes again', context)
    }
  }
}

/**
 * Watches every student audio track for the only symptom of a failed decryption (LiveKit raises
 * no event): sustained digital silence while unmuted. Logs, never interrupts the session.
 */
export function watchStudentAudioDecryption(
  room: Room,
  context: { sessionId: string; e2eeEnabled: boolean }
): void {
  room.on(
    RoomEvent.TrackSubscribed,
    (track: RemoteTrack, publication: RemoteTrackPublication, participant: RemoteParticipant) => {
      if (track.kind !== TrackKind.KIND_AUDIO || participant.kind === ParticipantKind.AGENT) return
      void watchTrack(track, publication, context).catch((error: unknown) =>
        logger.warn('Decryption watchdog stopped', { ...context, error })
      )
    }
  )
}
