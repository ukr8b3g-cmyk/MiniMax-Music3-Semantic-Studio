# V2.1-C DSP implementation notes

V2.1-C adds deterministic Reverb and Stereo Delay to the existing Track/Master effects rack.

## Reverb

The implementation uses an original deterministic Schroeder-style design tailored to the Semantic Studio Python/Browser parity contract. It does not vendor or link an external DSP library at runtime.

The comb-delay spacing is derived from the well-known FreeVerb tuning published by the Synthesis ToolKit (STK):

- STK project: https://github.com/thestk/stk
- Reference files: `src/FreeVerb.cpp`, `include/FreeVerb.h`
- STK license: MIT-style permissive license (`LICENSE` in the STK repository)
- Original STK authors: Perry R. Cook and Gary P. Scavone; STK FreeVerb port credited there to Gregory Burlet.

Signalsmith Audio's MIT-licensed DSP projects were also consulted for general implementation concepts such as explicit effect-tail accounting and modern reverb parameter separation. No Signalsmith source is vendored by this node.

Audacity/libSoX Reverb was consulted only as a user-interface/parameter vocabulary reference. Its GPL/LGPL implementation code is not copied into this project.

Python authoritative rendering generates a deterministic stereo impulse response from the same tuning and performs truncated FFT overlap-add convolution. Browser Draft rendering evaluates the equivalent feedback-comb response directly so interactive preview remains fast and closely aligned with the authoritative render.

## Stereo Delay

Stereo Delay is implemented locally as a bounded feedback delay. Ping-Pong mode cross-feeds left and right channels. Tail duration is computed deterministically to approximately -60 dB, with a bounded maximum duration.

## Tail-aware rendering

Effects that create audio after the source timeline report their tail length. Track tails are rendered before track summing; master-tail padding is then added before the master effect chain. This prevents Reverb/Delay from being truncated at the last clip boundary while preserving the existing render order.
