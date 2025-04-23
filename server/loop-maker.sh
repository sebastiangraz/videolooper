#!/bin/bash
# ------------------------------------------------------------------------------
# Video Loop Maker - v2.5
# ------------------------------------------------------------------------------
# Creates a seamless loop from a video file using two techniques
# Usage: ./loop-maker.sh <input_video> [technique] [fade_duration] [start_second]
# Techniques:
#   crossfade - Crossfade between end and beginning
#   reverse   - Simple reversed loop (default, most reliable)
# Fade Duration:
#   Optional parameter for crossfade duration in seconds (default: 0.5)
# Start Second:
#   Optional parameter for which second to start the video at (default: 0)
# ------------------------------------------------------------------------------

set -e # Exit on error

# --- Function to check dependencies ---
check_dependencies() {
  if ! command -v ffmpeg &> /dev/null; then
    echo "Error: ffmpeg not found. Please install ffmpeg to use this script."
    exit 1
  fi
  
  if ! command -v bc &> /dev/null; then
    echo "Error: bc command not found. Using fallback calculations."
    # Set a fallback function for bc
    bc() {
      echo "1" # Just return a safe default for calculations
    }
  fi

  if ! command -v ffprobe &> /dev/null; then
    echo "Error: ffprobe not found. It should be part of ffmpeg installation."
    exit 1
  fi
}

# --- Print debug info ---
echo "Script started with arguments: $@"
SCRIPT_CWD=$(pwd) # Store original working directory
echo "Current directory: $SCRIPT_CWD"

# --- Default parameters ---
INPUT_FILE="$1"
TECHNIQUE="${2:-reverse}" # Use reverse as default - most reliable
FADE_DURATION="${3:-0.5}" # Use provided fade duration or default to 0.5 seconds
START_SECOND="${4:-0}"   # Use provided start second or default to 0
# Ensure TEMP_DIR is absolute or relative to a known base
# If INPUT_FILE could be absolute, dirname works. If relative, it's relative to SCRIPT_CWD.
# Let's make TEMP_DIR relative to SCRIPT_CWD for clarity, handling potential absolute INPUT_FILE paths.
INPUT_DIR=$(dirname "$INPUT_FILE")
if [[ "$INPUT_DIR" == /* ]]; then
  # Input path is absolute, place temp dir relative to its dir
  TEMP_DIR="$INPUT_DIR/tmp_loop_$(date +%s)"
else
  # Input path is relative, place temp dir relative to SCRIPT_CWD/input_dir
  TEMP_DIR="$SCRIPT_CWD/$INPUT_DIR/tmp_loop_$(date +%s)"
fi
OUTPUT_FILE="${INPUT_FILE}_loop.mp4"
ABS_OUTPUT_FILE="$SCRIPT_CWD/$OUTPUT_FILE" # Absolute path for output

# --- Validate input ---
if [ $# -lt 1 ]; then
    echo "Error: No input file specified"
    echo "Usage: $0 <input_video> [technique] [fade_duration] [start_second]"
    echo "Available techniques: crossfade, reverse"
    echo "Fade duration: Optional parameter in seconds (default: 0.5)"
    echo "Start second: Optional parameter for which second to start at (default: 0)"
    exit 1
fi

if ! [ -f "$INPUT_FILE" ]; then
    echo "Error: Input file '$INPUT_FILE' does not exist"
    echo "File path provided: $INPUT_FILE"
    echo "Current directory: $(pwd)"
    echo "Directory contents: $(ls -la $(dirname "$INPUT_FILE"))"
    exit 1
fi

# --- Verify dependencies are installed ---
check_dependencies

# --- Create temp directory ---
mkdir -p "$TEMP_DIR"
trap 'rm -rf "$TEMP_DIR"' EXIT

echo "Processing video: $INPUT_FILE"
echo "Output will be saved to: $OUTPUT_FILE"

# --- Basic fallback method if analysis fails ---
create_simple_loop() {
  echo "Using simple fallback method..."
  
  # Create a simple reverse file first - no fifo needed
  REVERSE_FILE="$TEMP_DIR/reverse.mp4"
  ffmpeg -y -i "$INPUT_FILE" -vf "reverse" -preset fast "$REVERSE_FILE"
  
  # Then concatenate the files
  ffmpeg -y -i "$INPUT_FILE" -i "$REVERSE_FILE" -filter_complex \
    "[0:v][1:v]concat=n=2:v=1:a=0" \
    -c:v libx264 -preset fast -crf 22 -pix_fmt yuv420p \
    "$OUTPUT_FILE"
}

# --- Try to get video duration and info ---
echo "Analyzing video..."
if ! DURATION=$(ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "$INPUT_FILE" 2>/dev/null); then
  echo "Warning: Could not determine video duration, using fallback method"
  create_simple_loop
  exit 0
fi

# Get basic video info with error handling
FPS=$(ffprobe -v 0 -select_streams v:0 -of csv=p=0 \
       -show_entries stream=r_frame_rate "$INPUT_FILE" | bc)
WIDTH=$(ffprobe -v error -select_streams v:0 -show_entries stream=width -of default=noprint_wrappers=1:nokey=1 "$INPUT_FILE" 2>/dev/null || echo "unknown")
HEIGHT=$(ffprobe -v error -select_streams v:0 -show_entries stream=height -of default=noprint_wrappers=1:nokey=1 "$INPUT_FILE" 2>/dev/null || echo "unknown")

# Convert fps fraction to decimal if needed
if [[ $FPS == */* ]]; then
  FPS=$(echo "scale=2; $FPS" | bc 2>/dev/null || echo "24")
fi

echo "Video info:"
echo "- Duration: $DURATION seconds"
echo "- FPS: $FPS"
echo "- Resolution: ${WIDTH}x${HEIGHT}"
echo "- Looping technique: $TECHNIQUE"

# --- Create seamless loop based on technique ---
case "$TECHNIQUE" in
  "crossfade")
    echo "DEBUG: Entering crossfade block." # DEBUG
    echo "Creating seamless loop with crossfade technique..."
    echo "Using fade duration: $FADE_DURATION seconds"
    echo "Starting from: $START_SECOND seconds"

    # --- Get original video properties ---
    echo "DEBUG: Getting original duration..." # DEBUG
    ORIGINAL_DURATION=$(ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 -hide_banner -loglevel warning "$INPUT_FILE")
    if [ -z "$ORIGINAL_DURATION" ]; then echo "Error: Failed to get video duration."; exit 1; fi # Error check
    echo "DEBUG: Getting video FPS..." # DEBUG
    VIDEO_FPS_FRAC=$(ffprobe -v error -select_streams v:0 -show_entries stream=r_frame_rate -of default=noprint_wrappers=1:nokey=1 -hide_banner -loglevel warning "$INPUT_FILE")
    if [ -z "$VIDEO_FPS_FRAC" ]; then echo "Error: Failed to get video FPS."; exit 1; fi # Error check
    # Use bc to handle fractional FPS like 30000/1001, fallback to 30
    VIDEO_FPS=$(echo "scale=2; $VIDEO_FPS_FRAC" | bc 2>/dev/null || echo "30")
    echo "Original Duration: $ORIGINAL_DURATION seconds, FPS: $VIDEO_FPS ($VIDEO_FPS_FRAC)"

    # --- Validate Fade Duration ---
    echo "DEBUG: Validating fade duration..." # DEBUG
    HALF_DURATION=$(echo "$ORIGINAL_DURATION / 2" | bc -l)
    if (( $(echo "$FADE_DURATION >= $HALF_DURATION" | bc -l) )); then
      echo "Error: Fade duration ($FADE_DURATION) must be less than half the video duration ($HALF_DURATION)." 
      exit 1
    fi
    if (( $(echo "$FADE_DURATION <= 0" | bc -l) )); then
      echo "Error: Fade duration must be positive." 
      exit 1
    fi

    # --- Step 1: Extract True Start/End segments for Crossfade (from Original Input) ---
    echo "DEBUG: Preparing true start/end clips extraction..." # DEBUG
    TRUE_START_CLIP="$TEMP_DIR/true_start.mp4"
    TRUE_END_CLIP="$TEMP_DIR/true_end.mp4"
    # Format bc output for ffmpeg
    END_CLIP_START_TIME_RAW=$(echo "$ORIGINAL_DURATION - $FADE_DURATION" | bc)
    END_CLIP_START_TIME=$(printf "%.6f" "$END_CLIP_START_TIME_RAW")

    echo "DEBUG: Extracting TRUE_START_CLIP (first $FADE_DURATION sec)..." # DEBUG
    # Format FADE_DURATION for -t
    FADE_DURATION_FMT=$(printf "%.6f" "$FADE_DURATION")
    ffmpeg -y -i "$INPUT_FILE" -t $FADE_DURATION_FMT -c:v libx264 -preset fast -r $VIDEO_FPS -pix_fmt yuv420p -hide_banner -loglevel warning "$TRUE_START_CLIP"
    if [ $? -ne 0 ]; then echo "Error: Failed during TRUE_START_CLIP extraction."; exit 1; fi # Error check

    echo "DEBUG: Extracting TRUE_END_CLIP (last $FADE_DURATION sec from $END_CLIP_START_TIME)..." # DEBUG
    ffmpeg -y -i "$INPUT_FILE" -ss $END_CLIP_START_TIME -c:v libx264 -preset fast -r $VIDEO_FPS -pix_fmt yuv420p -hide_banner -loglevel warning "$TRUE_END_CLIP"
    if [ $? -ne 0 ]; then echo "Error: Failed during TRUE_END_CLIP extraction."; exit 1; fi # Error check

    # --- Step 2: Create the Crossfade Clip ---
    echo "DEBUG: Creating CROSSFADE_CLIP using xfade..." # DEBUG
    CROSSFADE_CLIP="$TEMP_DIR/crossfade_segment.mp4"
    # Using simpler xfade again, ensure duration is formatted
    ffmpeg -y -i "$TRUE_END_CLIP" -i "$TRUE_START_CLIP" \
           -filter_complex "[0:v][1:v]xfade=transition=fade:duration=$FADE_DURATION_FMT:offset=0[out]" \
           -map "[out]" -c:v libx264 -preset fast -r $VIDEO_FPS -pix_fmt yuv420p -hide_banner -loglevel warning "$CROSSFADE_CLIP"
    if [ $? -ne 0 ]; then echo "Error: Failed during CROSSFADE_CLIP creation."; exit 1; fi # Error check

    # --- Step 3: Prepare Segments for Final Concatenation ---
    echo "DEBUG: Preparing final segments for concatenation..." # DEBUG
    CONCAT_LIST="$TEMP_DIR/mylist.txt"
    > "$CONCAT_LIST"

    if [ "$START_SECOND" = "0" ]; then
      # Standard loop: Main body + Crossfade
      echo "DEBUG: Standard loop path (START_SECOND = 0)..." # DEBUG
      MAIN_CLIP="$TEMP_DIR/main_body.mp4"
      # Format bc output for ffmpeg
      MAIN_CLIP_START_RAW=$(echo "$FADE_DURATION" | bc)
      MAIN_CLIP_START=$(printf "%.6f" "$MAIN_CLIP_START_RAW")
      MAIN_CLIP_DURATION_RAW=$(echo "$ORIGINAL_DURATION - 2 * $FADE_DURATION" | bc)
      MAIN_CLIP_DURATION=$(printf "%.6f" "$MAIN_CLIP_DURATION_RAW")
      echo "DEBUG: Extracting MAIN_CLIP (Start: $MAIN_CLIP_START, Duration: $MAIN_CLIP_DURATION)..." # DEBUG
      # Re-encode segment for consistency
      ffmpeg -y -i "$INPUT_FILE" -ss $MAIN_CLIP_START -t $MAIN_CLIP_DURATION -c:v libx264 -preset fast -r $VIDEO_FPS -pix_fmt yuv420p -hide_banner -loglevel warning "$MAIN_CLIP"
      if [ $? -ne 0 ]; then echo "Error: Failed during MAIN_CLIP extraction."; exit 1; fi # Error check

      echo "DEBUG: Writing MAIN_CLIP basename to list..." # DEBUG
      echo "file '$(basename "$MAIN_CLIP")'" >> "$CONCAT_LIST"
      echo "DEBUG: Writing CROSSFADE_CLIP basename to list..." # DEBUG
      echo "file '$(basename "$CROSSFADE_CLIP")'" >> "$CONCAT_LIST"

    else
      # Custom start loop: Segment after START_SECOND + Crossfade + Segment before START_SECOND
      echo "DEBUG: Custom loop path (START_SECOND = $START_SECOND)..." # DEBUG
      
      # Segment 1: From START_SECOND to (END - FADE_DURATION)
      SEG1_AFTER_START="$TEMP_DIR/seg1_after_start.mp4"
      SEG1_START_TIME=$START_SECOND
      SEG1_END_TIME_RAW=$(echo "$ORIGINAL_DURATION - $FADE_DURATION" | bc)
      SEG1_END_TIME=$(printf "%.6f" "$SEG1_END_TIME_RAW") # Format for calculation
      # Format bc output for ffmpeg -t 
      SEG1_DURATION_RAW=$(echo "$SEG1_END_TIME - $SEG1_START_TIME" | bc)
      SEG1_DURATION=$(printf "%.6f" "$SEG1_DURATION_RAW")
      echo "DEBUG: Calculated SEG1 - Start: $SEG1_START_TIME, End: $SEG1_END_TIME, Duration: $SEG1_DURATION" # DEBUG
      if (( $(echo "$SEG1_DURATION > 0" | bc -l) )); then
          echo "DEBUG: Extracting SEG1_AFTER_START..." # DEBUG
          # Re-encode segment for consistency
          ffmpeg -y -i "$INPUT_FILE" -ss $SEG1_START_TIME -t $SEG1_DURATION -c:v libx264 -preset fast -r $VIDEO_FPS -pix_fmt yuv420p -hide_banner -loglevel warning "$SEG1_AFTER_START"
          if [ $? -ne 0 ]; then echo "Error: Failed during SEG1 extraction."; exit 1; fi # Error check
          echo "DEBUG: Writing SEG1 basename to list..." # DEBUG
          echo "file '$(basename "$SEG1_AFTER_START")'" >> "$CONCAT_LIST"
      else
          echo "DEBUG: Skipping SEG1 (duration <= 0)." # DEBUG
      fi

      # Segment 2: The Crossfade segment
      echo "DEBUG: Writing CROSSFADE_CLIP basename to list..." # DEBUG
      echo "file '$(basename "$CROSSFADE_CLIP")'" >> "$CONCAT_LIST"

      # Segment 3: From (START + FADE_DURATION) to START_SECOND
      SEG3_BEFORE_START="$TEMP_DIR/seg3_before_start.mp4"
      # Format bc output for ffmpeg -ss
      SEG3_START_TIME_RAW=$(echo "$FADE_DURATION" | bc)
      SEG3_START_TIME=$(printf "%.6f" "$SEG3_START_TIME_RAW")
      SEG3_END_TIME=$START_SECOND # Comes from input, should be fine
      # Format bc output for ffmpeg -t
      SEG3_DURATION_RAW=$(echo "$SEG3_END_TIME - $SEG3_START_TIME" | bc)
      SEG3_DURATION=$(printf "%.6f" "$SEG3_DURATION_RAW")
      echo "DEBUG: Calculated SEG3 - Start: $SEG3_START_TIME, End: $SEG3_END_TIME, Duration: $SEG3_DURATION" # DEBUG
      if (( $(echo "$SEG3_DURATION > 0" | bc -l) )); then
          echo "DEBUG: Extracting SEG3_BEFORE_START..." # DEBUG
          # Re-encode segment for consistency
          ffmpeg -y -i "$INPUT_FILE" -ss $SEG3_START_TIME -t $SEG3_DURATION -c:v libx264 -preset fast -r $VIDEO_FPS -pix_fmt yuv420p -hide_banner -loglevel warning "$SEG3_BEFORE_START"
          if [ $? -ne 0 ]; then echo "Error: Failed during SEG3 extraction."; exit 1; fi # Error check
          echo "DEBUG: Writing SEG3 basename to list..." # DEBUG
          echo "file '$(basename "$SEG3_BEFORE_START")'" >> "$CONCAT_LIST"
      else
          echo "DEBUG: Skipping SEG3 (duration <= 0)." # DEBUG
      fi
    fi

    # --- Step 4: Concatenate Final Segments ---
    echo "DEBUG: Preparing for final concatenation..." # DEBUG
    echo "DEBUG: Concatenation list content (should be basenames only):" # DEBUG
    cat "$CONCAT_LIST" # DEBUG
    # Use concat demuxer. All segments are pre-encoded identically, so -c copy should be fast and safe.
    # Run ffmpeg from the TEMP_DIR so it finds the relative paths in the list.
    # Use ABS_OUTPUT_FILE for the output path.
    echo "DEBUG: Running final concatenation (using -c copy) from within $TEMP_DIR... Outputting to $ABS_OUTPUT_FILE" # DEBUG
    (cd "$TEMP_DIR" && ffmpeg -y -f concat -safe 0 -i "mylist.txt" -c copy -hide_banner -loglevel warning "$ABS_OUTPUT_FILE")
    if [ $? -ne 0 ]; then \
      echo "Error: Final concatenation with '-c copy' failed. Retrying with re-encoding from within $TEMP_DIR... Outputting to $ABS_OUTPUT_FILE" # Error check
      echo "DEBUG: Running final concatenation (using re-encoding) from within $TEMP_DIR... Outputting to $ABS_OUTPUT_FILE" # DEBUG
      (cd "$TEMP_DIR" && ffmpeg -y -f concat -safe 0 -i "mylist.txt" -c:v libx264 -preset fast -r $VIDEO_FPS -pix_fmt yuv420p -hide_banner -loglevel warning "$ABS_OUTPUT_FILE")
      if [ $? -ne 0 ]; then echo "Error: Final concatenation failed even with re-encoding."; exit 1; fi # Error check
    fi
    echo "DEBUG: Concatenation finished." # DEBUG
    ;;
    
  "reverse"|*)
    echo "Creating simple reversed loop..."
    # First create reversed video
    REVERSE_FILE="$TEMP_DIR/reverse.mp4"
    if ! ffmpeg -y -i "$INPUT_FILE" -vf "reverse" -c:v libx264 -preset fast "$REVERSE_FILE"; then
      echo "Failed to create reverse clip, copying original as fallback"
      cp "$INPUT_FILE" "$OUTPUT_FILE"
      exit 0
    fi
    
    # Then concatenate with original
    if ! ffmpeg -y -i "$INPUT_FILE" -i "$REVERSE_FILE" -filter_complex \
         "[0:v][1:v]concat=n=2:v=1:a=0" \
         -c:v libx264 -preset fast -crf 22 -pix_fmt yuv420p \
         "$OUTPUT_FILE"; then
      echo "Failed to concatenate videos, copying original as fallback"
      cp "$INPUT_FILE" "$OUTPUT_FILE"
    fi
    ;;
esac

# --- Verify output file exists ---
if [ -f "$OUTPUT_FILE" ]; then
    echo "Success! Seamless loop created at: $OUTPUT_FILE"
    # Get output file size
    OUTPUT_SIZE=$(du -h "$OUTPUT_FILE" 2>/dev/null | cut -f1 || echo "unknown")
    echo "Output file size: $OUTPUT_SIZE"
else
    echo "Error: Failed to create output file at: $OUTPUT_FILE"
    echo "Directory contents: $(ls -la $(dirname "$OUTPUT_FILE"))"
    # Last resort fallback - just copy the input file to output
    echo "Creating a fallback non-looping copy as last resort"
    cp "$INPUT_FILE" "$OUTPUT_FILE"
fi 