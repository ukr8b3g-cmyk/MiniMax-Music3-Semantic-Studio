# Native VST3 editor window

The VST3 editor remains a separate Windows-native window owned by Pedalboard/JUCE.

The helper process now:

- detects the actual native plugin editor window
- restores a standard Windows caption/system frame when a plugin appears borderless
- preserves the plugin client-area size
- recentres only the default upper-left or mostly off-screen placement
- leaves an already user-positioned window in place

This makes the plugin window draggable through its normal Windows title bar. It does not alter plugin state, DSP order, Queue rendering, or the shared Semantic/Audio Editor web window shell.
