# Recording import into DaVinci Resolve

A failing recording was not attached, so its actual codecs, MP4 structure, timing and Resolve version could not be inspected. The exact reason it fails to import is still unconfirmed.

The previous recorder tried H.264/AAC with a fixed codec profile, then silently accepted generic `video/mp4`. Generic MP4 does not specify which codecs the browser chooses. Its MIME label alone is not a file-level diagnosis. Browser capture can also produce fragmented containers and variable frame timing. Those are things to inspect, not confirmed faults in your recording.

Resolve's official macOS codec list supports H.264, AAC and ProRes. Resolve 20 also lists Opus in MOV/MP4, so it would be wrong to assume every Opus recording fails. Version, platform and the actual media matter. Source: [Blackmagic Design — Resolve 20 codec list](https://documents.blackmagicdesign.com/SupportNotes/DaVinci_Resolve_20_Supported_Codec_List.pdf).

## New recordings

In Output, click **Editor MP4 settings**. This selects an MP4 option, requests 1080 pixels tall and 30 fps, and enables **MP4 editor compatibility**. The recorder requests H.264 video and AAC audio explicitly. If no supported explicit combination is offered, it reports that instead of silently switching codecs. Uncheck compatibility to use the original broader capture choices.

The new **Recording report** button saves the browser-reported MIME type, requested dimensions/frame rate/bitrate and take size/duration. This is diagnostic information, not verification of the encoded stream. A supported MIME type is also not a guarantee that a hardware encoder can start at every resolution. Chrome's feature documentation describes its H.264/AAC MP4 capture support: [Chrome Platform Status](https://chromestatus.com/feature/5163469011943424).

## Existing recordings

The visualiser still runs standalone. The optional conversion helper needs **Python 3 and FFmpeg installed separately**, with FFmpeg on PATH. It does not install anything or upload your video.

On Mac, open `Convert-for-Resolve.command` and choose the recording. It writes a new ProRes 422 LT MOV with 48 kHz PCM audio at 30 fps next to the source. These files are larger than delivery MP4s. If macOS prevents opening a downloaded script, run the Python command below in Terminal instead; do not disable system security.

From the folder, for a 30 fps ProRes MOV:

```sh
python3 convert-for-resolve.py "/path/to/recording.mp4"
```

To retain a 60 fps workflow:

```sh
python3 convert-for-resolve.py "/path/to/recording.mp4" --fps 60
```

For a smaller H.264/AAC MP4 with constant frame timing and even dimensions:

```sh
python3 convert-for-resolve.py "/path/to/recording.mp4" --format h264 --fps 30
```

For a fast container-only rewrite without recompression:

```sh
python3 convert-for-resolve.py "/path/to/recording.mp4" --format remux
```

Remuxing does not change unsupported codecs or variable frame timing. The other modes transcode and can duplicate/drop frames to meet the selected frame rate; they cannot restore missing frames or lost audio. All modes preserve the source and refuse to overwrite an existing output. If ffprobe is available, the helper also saves a source-info JSON alongside the new file. Sources: [FFmpeg codecs](https://ffmpeg.org/ffmpeg-codecs.html), [FFmpeg containers and faststart](https://ffmpeg.org/ffmpeg-formats.html).

The helper was tested with a generated fragmented H.264/AAC MP4. All three outputs were inspected with ffprobe; ProRes/PCM and H.264/AAC conversions had the requested 30 fps and retained audio. Actual Resolve import was not tested. For exact diagnosis, provide one failing recording, the Recording report if available, and your Resolve version and Free/Studio edition.
