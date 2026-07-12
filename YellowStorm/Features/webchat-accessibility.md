# Webchat Accessibility

The embedded YellowStorm webchat includes an accessibility foundation for keyboard, visual, voice, and read-aloud support while preserving the one-script Shadow DOM embed model.

## Owner Settings

Widget settings include an `accessibility` object with safe defaults for:

- Visitor accessibility settings availability.
- Default accessibility profile.
- High contrast, large target, simplified, focus, and motion feature flags.
- Voice input configuration.
- Read-aloud configuration.
- Screen-reader announcement configuration.
- Keyboard shortcut configuration.

Backend normalization deep-merges missing settings for existing agents and forces privacy/safety values:

- `voiceInput.retainAudio` is always `false`.
- `voiceInput.autoSend` is always `false`.
- `readAloud.autoPlay` is always `false`.

## Visitor Preferences

When enabled, the widget shows a dedicated accessibility button in the header. Visitor profile choices are stored locally under:

```text
ys_widget_accessibility:<agentId>
```

Only UI preferences are stored. No disability label, dictated content, or raw audio is stored.

## Runtime Features

- Labelled chat dialog and message log.
- Visible focus styling and keyboard focus containment.
- Larger default text and target sizes.
- Mobile full-height sheet that remains within the viewport.
- Accessibility profiles for low vision, high contrast, motor assistance, cognitive comfort, and low stimulation.
- Explicit microphone dictation where browser speech recognition is available.
- Per-response read-aloud where browser speech synthesis is available.
- Speech stops when the widget closes or the page is hidden.

Buffered screen-reader streaming announcements are intentionally not included in this implementation slice.

## Browser Limitations

Voice input depends on `SpeechRecognition` or `webkitSpeechRecognition`. Read aloud depends on `speechSynthesis` and `SpeechSynthesisUtterance`. Unsupported browsers keep the widget usable and show a non-blocking message when the feature is requested.
