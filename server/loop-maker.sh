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
  # First, check if we have FFMPEG_PATH from environment (set by ffmpeg-static)
  if [ -n "$FFMPEG_PATH" ] && [ -x "$FFMPEG_PATH" ]; then
    echo "Using bundled ffmpeg at: $FFMPEG_PATH"
    FFMPEG="$FFMPEG_PATH"
    
    # Check for FFPROBE_PATH from environment (set by ffprobe-static)
    if [ -n "$FFPROBE_PATH" ] && [ -x "$FFPROBE_PATH" ]; then
      echo "Using bundled ffprobe at: $FFPROBE_PATH"
      FFPROBE="$FFPROBE_PATH"
    else
      # Attempt to get ffprobe path from the same directory
      FFPROBE_PATH="${FFMPEG_PATH%/*}/ffprobe"
      if [ -x "$FFPROBE_PATH" ]; then
        FFPROBE="$FFPROBE_PATH"
      else
        # Fallback to command-line ffprobe
        if command -v ffprobe &> /dev/null; then
          FFPROBE="ffprobe"
        else
          echo "Error: ffprobe not found. Please install ffmpeg with ffprobe."
          exit 1
        fi
      fi
    fi
  else
    # Use system commands if FFMPEG_PATH is not set
    if ! command -v ffmpeg &> /dev/null; then
      echo "Error: ffmpeg not found. Please install ffmpeg to use this script."
      exit 1
    fi
    
    if ! command -v ffprobe &> /dev/null; then
      echo "Error: ffprobe not found. It should be part of ffmpeg installation."
      exit 1
    fi
    
    FFMPEG="ffmpeg"
    FFPROBE="ffprobe"
  fi
  
  # Check for bc, important for calculations
  if ! command -v bc &> /dev/null; then
    echo "Warning: bc command not found. Using fallback calculations."
    # Create a more robust bc function fallback that can handle basic operations
    bc() {
      local input
      # Read from stdin if no arguments provided
      if [ "$#" -eq 0 ]; then
        read input
      else
        input="$1"
      fi
      
      # Handle common calculation scenarios
      if [[ "$input" == *"/"* ]]; then
        # Handle division (assume simple fraction for FPS like 30000/1001)
        echo "30" # Common approximation for video FPS
      elif [[ "$input" == "scale="* ]]; then
        # Scale command, just return the number after the expression
        echo "$input" | grep -o '[0-9.]*$'
      elif [[ "$input" == *">"* || "$input" == *"<"* || "$input" == *"=="* ]]; then
        # Comparison operations (for fade duration checks)
        # Simple true/false based on comparison
        if [[ "$input" == *">="* ]]; then
          echo "0" # false
        elif [[ "$input" == *"<="* ]]; then
          echo "0" # false
        elif [[ "$input" == *"=="* ]]; then
          echo "0" # false
        elif [[ "$input" == *">"* ]]; then
          echo "1" # true
        elif [[ "$input" == *"<"* ]]; then
          echo "1" # true
        else
          echo "0" # default to false for unknown comparison
        fi
      elif [[ "$input" == *"-"* ]]; then
        # Simple subtraction
        echo "1" # Default to safe positive value
      elif [[ "$input" == *"+"* ]]; then
        # Simple addition
        echo "1" # Default to safe positive value
      elif [[ "$input" == *"*"* ]]; then
        # Simple multiplication
        echo "1" # Default to safe positive value
      else
        # Unknown operation, return a safe default
        echo "1"
      fi
    }
    export -f bc
  fi
}

# --- Print debug info ---
echo "Script started with arguments: $@"
echo "Current directory: $(pwd)"

# --- Default parameters ---
INPUT_FILE="$1"
TECHNIQUE="${2:-reverse}" # Use reverse as default - most reliable
FADE_DURATION="${3:-0.5}" # Use provided fade duration or default to 0.5 seconds
START_SECOND="${4:-0}"   # Use provided start second or default to 0
TEMP_DIR=$(dirname "$INPUT_FILE")/tmp_loop_$(date +%s)
OUTPUT_FILE="${INPUT_FILE}_loop.mp4"
# Define the absolute output path needed for ffmpeg when running in TEMP_DIR
ABS_OUTPUT_FILE="$(pwd)/$OUTPUT_FILE"

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
  $FFMPEG -y -i "$INPUT_FILE" -vf "reverse" -preset fast "$REVERSE_FILE"
  
  # Then concatenate the files
  $FFMPEG -y -i "$INPUT_FILE" -i "$REVERSE_FILE" -filter_complex \
    "[0:v][1:v]concat=n=2:v=1:a=0" \
    -c:v libx264 -preset fast -crf 22 -pix_fmt yuv420p \
    "$OUTPUT_FILE"
}

# --- Try to get video duration and info ---
echo "Analyzing video..."
if ! DURATION=$($FFPROBE -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "$INPUT_FILE" 2>/dev/null); then
  echo "Warning: Could not determine video duration, using fallback method"
  create_simple_loop
  exit 0
fi

# Get basic video info with error handling
FPS=$($FFPROBE -v 0 -select_streams v:0 -of csv=p=0 \
       -show_entries stream=r_frame_rate "$INPUT_FILE" | bc)
WIDTH=$($FFPROBE -v error -select_streams v:0 -show_entries stream=width -of default=noprint_wrappers=1:nokey=1 "$INPUT_FILE" 2>/dev/null || echo "unknown")
HEIGHT=$($FFPROBE -v error -select_streams v:0 -show_entries stream=height -of default=noprint_wrappers=1:nokey=1 "$INPUT_FILE" 2>/dev/null || echo "unknown")

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
    echo "Creating seamless loop with crossfade technique..."
    echo "Using fade duration: $FADE_DURATION seconds"
    echo "Starting from: $START_SECOND seconds"

    # --- Get original video properties ---
    ORIGINAL_DURATION=$($FFPROBE -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 -hide_banner -loglevel warning "$INPUT_FILE")
    if [ -z "$ORIGINAL_DURATION" ]; then echo "Error: Failed to get video duration."; exit 1; fi
    VIDEO_FPS_FRAC=$($FFPROBE -v error -select_streams v:0 -show_entries stream=r_frame_rate -of default=noprint_wrappers=1:nokey=1 -hide_banner -loglevel warning "$INPUT_FILE")
    if [ -z "$VIDEO_FPS_FRAC" ]; then echo "Error: Failed to get video FPS."; exit 1; fi
    # Use bc to handle fractional FPS like 30000/1001 for calculations, fallback to 30
    VIDEO_FPS=$(echo "scale=2; $VIDEO_FPS_FRAC" | bc 2>/dev/null || echo "30")
    echo "Original Duration: $ORIGINAL_DURATION seconds, FPS: $VIDEO_FPS ($VIDEO_FPS_FRAC)"

    # --- Handle Zero Fade Duration Case ---
    if (( $(echo "$FADE_DURATION == 0" | bc -l) )); then
      echo "Fade duration is 0. Performing direct concatenation without fade."
      if [ "$START_SECOND" = "0" ]; then
        # No fade, no reorder: just copy the original file
        echo "Start second is 0. Copying original file directly."
        cp "$INPUT_FILE" "$ABS_OUTPUT_FILE"
        if [ $? -ne 0 ]; then echo "Error: Failed to copy input file for zero fade/start."; exit 1; fi
      else
        # No fade, but reorder based on START_SECOND
        echo "Reordering video segments for START_SECOND=$START_SECOND without fade..."
        # Define paths for segments
        AFTER_PART_REL="after_start_nofade.mp4"
        BEFORE_PART_REL="before_start_nofade.mp4"
        AFTER_PART_ABS="$TEMP_DIR/$AFTER_PART_REL"
        BEFORE_PART_ABS="$TEMP_DIR/$BEFORE_PART_REL"
        # Define concat list
        CONCAT_LIST_NOFADE="mylist_nofade.txt"
        CONCAT_LIST_NOFADE_ABS="$TEMP_DIR/$CONCAT_LIST_NOFADE"
        
        # Extract segment after START_SECOND (to end)
        echo "Extracting segment after $START_SECOND seconds..."
        $FFMPEG -y -i "$INPUT_FILE" -ss $START_SECOND -c copy -hide_banner -loglevel warning "$AFTER_PART_ABS"
        if [ $? -ne 0 ]; then echo "Error: Failed extracting AFTER part for zero fade."; exit 1; fi
        
        # Extract segment before START_SECOND (from start)
        echo "Extracting segment before $START_SECOND seconds..."
        $FFMPEG -y -i "$INPUT_FILE" -to $START_SECOND -c copy -hide_banner -loglevel warning "$BEFORE_PART_ABS"
        if [ $? -ne 0 ]; then echo "Error: Failed extracting BEFORE part for zero fade."; exit 1; fi
        
        # Create concatenation list
        echo "Creating concatenation list: $CONCAT_LIST_NOFADE_ABS"
        > "$CONCAT_LIST_NOFADE_ABS"
        echo "file '$AFTER_PART_REL'" >> "$CONCAT_LIST_NOFADE_ABS"
        echo "file '$BEFORE_PART_REL'" >> "$CONCAT_LIST_NOFADE_ABS"
        cat "$CONCAT_LIST_NOFADE_ABS" # Display list
        
        # Concatenate using concat demuxer (fast copy)
        echo "Concatenating segments without fade..."
        (cd "$TEMP_DIR" && $FFMPEG -y -f concat -safe 0 -i "$CONCAT_LIST_NOFADE" -c copy -hide_banner -loglevel warning "$ABS_OUTPUT_FILE")
        if [ $? -ne 0 ]; then echo "Error: Failed concatenating segments for zero fade."; exit 1; fi
      fi
      # Skip the rest of the crossfade logic if fade duration was 0
      echo "Zero fade processing complete."
    else
      # --- Standard Crossfade Logic (Fade Duration > 0) ---
      # --- Validate Fade Duration ---
      HALF_DURATION=$(echo "$ORIGINAL_DURATION / 2" | bc -l)
      if (( $(echo "$FADE_DURATION >= $HALF_DURATION" | bc -l) )); then
        echo "Error: Fade duration ($FADE_DURATION) must be less than half the video duration ($HALF_DURATION)."
        exit 1
      fi
      if (( $(echo "$FADE_DURATION <= 0" | bc -l) )); then
        # This case should technically not be hit due to the outer check, but included for safety
        echo "Error: Fade duration must be positive for crossfade effect."
        exit 1
      fi
      
      # Format fade duration once for ffmpeg time options
      FADE_DURATION_FMT=$(printf "%.6f" "$FADE_DURATION")
      
      # --- Step 1: Extract True Start/End segments for Crossfade (from Original Input) ---
      echo "Extracting segments for crossfade..."
      TRUE_START_CLIP="$TEMP_DIR/true_start.mp4"
      TRUE_END_CLIP="$TEMP_DIR/true_end.mp4"
      # Calculate and format end clip's start time
      END_CLIP_START_TIME_RAW=$(echo "$ORIGINAL_DURATION - $FADE_DURATION" | bc)
      END_CLIP_START_TIME=$(printf "%.6f" "$END_CLIP_START_TIME_RAW")
      
      # Extract first FADE_DURATION seconds
      $FFMPEG -y -i "$INPUT_FILE" -t $FADE_DURATION_FMT -c:v libx264 -preset fast -r $VIDEO_FPS -pix_fmt yuv420p -hide_banner -loglevel warning "$TRUE_START_CLIP"
      if [ $? -ne 0 ]; then echo "Error: Failed during TRUE_START_CLIP extraction."; exit 1; fi
      
      # Extract last FADE_DURATION seconds
      $FFMPEG -y -i "$INPUT_FILE" -ss $END_CLIP_START_TIME -c:v libx264 -preset fast -r $VIDEO_FPS -pix_fmt yuv420p -hide_banner -loglevel warning "$TRUE_END_CLIP"
      if [ $? -ne 0 ]; then echo "Error: Failed during TRUE_END_CLIP extraction."; exit 1; fi
      
      # --- Step 2: Create the Crossfade Clip ---
      echo "Creating crossfade segment..."
      CROSSFADE_CLIP="$TEMP_DIR/crossfade_segment.mp4"
      # Use xfade filter with formatted duration
      $FFMPEG -y -i "$TRUE_END_CLIP" -i "$TRUE_START_CLIP" \
             -filter_complex "[0:v][1:v]xfade=transition=fade:duration=$FADE_DURATION_FMT:offset=0[out]" \
             -map "[out]" -c:v libx264 -preset fast -r $VIDEO_FPS -pix_fmt yuv420p -hide_banner -loglevel warning "$CROSSFADE_CLIP"
      if [ $? -ne 0 ]; then echo "Error: Failed during CROSSFADE_CLIP creation."; exit 1; fi
      
      # --- Step 3: Prepare File List for Final Concatenation ---
      echo "Preparing file list for concatenation..."
      CONCAT_LIST="mylist.txt" # Use relative name for list within TEMP_DIR
      CONCAT_LIST_ABS="$TEMP_DIR/$CONCAT_LIST" # Absolute path for writing
      > "$CONCAT_LIST_ABS"
      
      if [ "$START_SECOND" = "0" ]; then
        # --- Standard loop (Start = 0): Main body + Crossfade ---
        echo "Extracting main body for standard loop..."
        MAIN_CLIP="main_body.mp4" # Relative filename
        MAIN_CLIP_ABS="$TEMP_DIR/$MAIN_CLIP" # Absolute path for extraction
        # Calculate and format start time and duration
        MAIN_CLIP_START_RAW=$(echo "$FADE_DURATION" | bc)
        MAIN_CLIP_START=$(printf "%.6f" "$MAIN_CLIP_START_RAW")
        MAIN_CLIP_DURATION_RAW=$(echo "$ORIGINAL_DURATION - 2 * $FADE_DURATION" | bc)
        MAIN_CLIP_DURATION=$(printf "%.6f" "$MAIN_CLIP_DURATION_RAW")
        # Extract main segment (re-encode for consistency)
        $FFMPEG -y -i "$INPUT_FILE" -ss $MAIN_CLIP_START -t $MAIN_CLIP_DURATION -c:v libx264 -preset fast -r $VIDEO_FPS -pix_fmt yuv420p -hide_banner -loglevel warning "$MAIN_CLIP_ABS"
        if [ $? -ne 0 ]; then echo "Error: Failed during MAIN_CLIP extraction."; exit 1; fi
        
        # Add relative filenames to list
        echo "file '$MAIN_CLIP'" >> "$CONCAT_LIST_ABS"
        echo "file '$(basename "$CROSSFADE_CLIP")'" >> "$CONCAT_LIST_ABS"
        
      else
        # --- Custom loop (Start != 0): Part after Start + Crossfade + Part before Start ---
        echo "Extracting segments for custom loop start..."
        
        # -- Segment 1: From START_SECOND to (End - Fade Duration) --
        SEG1_AFTER_START="seg1_after_start.mp4" # Relative filename
        SEG1_AFTER_START_ABS="$TEMP_DIR/$SEG1_AFTER_START" # Absolute path for extraction
        SEG1_START_TIME=$START_SECOND
        # Calculate end time and duration, format for ffmpeg
        SEG1_END_TIME_RAW=$(echo "$ORIGINAL_DURATION - $FADE_DURATION" | bc)
        SEG1_END_TIME=$(printf "%.6f" "$SEG1_END_TIME_RAW")
        SEG1_DURATION_RAW=$(echo "$SEG1_END_TIME - $SEG1_START_TIME" | bc)
        SEG1_DURATION=$(printf "%.6f" "$SEG1_DURATION_RAW")
        # Extract if duration is positive
        if (( $(echo "$SEG1_DURATION > 0" | bc -l) )); then
            echo "Extracting segment 1 (Start: $SEG1_START_TIME, Duration: $SEG1_DURATION)..."
            $FFMPEG -y -i "$INPUT_FILE" -ss $SEG1_START_TIME -t $SEG1_DURATION -c:v libx264 -preset fast -r $VIDEO_FPS -pix_fmt yuv420p -hide_banner -loglevel warning "$SEG1_AFTER_START_ABS"
            if [ $? -ne 0 ]; then echo "Error: Failed during SEG1 extraction."; exit 1; fi
            # Add relative filename to list
            echo "file '$SEG1_AFTER_START'" >> "$CONCAT_LIST_ABS"
        else
            echo "Skipping segment 1 (duration <= 0)."
        fi
        
        # -- Segment 2: The Crossfade segment --
        echo "Adding crossfade segment to list..."
        echo "file '$(basename "$CROSSFADE_CLIP")'" >> "$CONCAT_LIST_ABS"
        
        # -- Segment 3: From (Start + Fade Duration) to START_SECOND --
        SEG3_BEFORE_START="seg3_before_start.mp4" # Relative filename
        SEG3_BEFORE_START_ABS="$TEMP_DIR/$SEG3_BEFORE_START" # Absolute path for extraction
        # Calculate start time and duration, format for ffmpeg
        SEG3_START_TIME_RAW=$(echo "$FADE_DURATION" | bc)
        SEG3_START_TIME=$(printf "%.6f" "$SEG3_START_TIME_RAW")
        SEG3_END_TIME=$START_SECOND
        SEG3_DURATION_RAW=$(echo "$SEG3_END_TIME - $SEG3_START_TIME" | bc)
        SEG3_DURATION=$(printf "%.6f" "$SEG3_DURATION_RAW")
        # Extract if duration is positive
        if (( $(echo "$SEG3_DURATION > 0" | bc -l) )); then
            echo "Extracting segment 3 (Start: $SEG3_START_TIME, Duration: $SEG3_DURATION)..."
            $FFMPEG -y -i "$INPUT_FILE" -ss $SEG3_START_TIME -t $SEG3_DURATION -c:v libx264 -preset fast -r $VIDEO_FPS -pix_fmt yuv420p -hide_banner -loglevel warning "$SEG3_BEFORE_START_ABS"
            if [ $? -ne 0 ]; then echo "Error: Failed during SEG3 extraction."; exit 1; fi
            # Add relative filename to list
            echo "file '$SEG3_BEFORE_START'" >> "$CONCAT_LIST_ABS"
        else
            echo "Skipping segment 3 (duration <= 0)."
        fi
      fi
      
      # --- Step 4: Concatenate Final Segments ---
      echo "Concatenating final video..."
      echo "Using list file: $CONCAT_LIST_ABS"
      cat "$CONCAT_LIST_ABS" # Display list content for verification
      # Use concat demuxer. Run from TEMP_DIR, use relative list name, output to absolute path.
      # Attempt fast copy first, fallback to re-encoding.
      (cd "$TEMP_DIR" && $FFMPEG -y -f concat -safe 0 -i "$CONCAT_LIST" -c copy -hide_banner -loglevel warning "$ABS_OUTPUT_FILE")
      if [ $? -ne 0 ]; then
        echo "Warning: Concatenation with '-c copy' failed. Retrying with re-encoding..."
        (cd "$TEMP_DIR" && $FFMPEG -y -f concat -safe 0 -i "$CONCAT_LIST" -c:v libx264 -preset fast -r $VIDEO_FPS -pix_fmt yuv420p -hide_banner -loglevel warning "$ABS_OUTPUT_FILE")
        if [ $? -ne 0 ]; then echo "Error: Final concatenation failed even with re-encoding."; exit 1; fi
      fi
    fi
    ;;
    
  "reverse"|*)
    echo "Creating simple reversed loop..."
    # First create reversed video
    REVERSE_FILE="$TEMP_DIR/reverse.mp4"
    if ! $FFMPEG -y -i "$INPUT_FILE" -vf "reverse" -c:v libx264 -preset fast "$REVERSE_FILE"; then
      echo "Failed to create reverse clip, copying original as fallback"
      cp "$INPUT_FILE" "$OUTPUT_FILE"
      exit 0
    fi
    
    # Then concatenate with original
    if ! $FFMPEG -y -i "$INPUT_FILE" -i "$REVERSE_FILE" -filter_complex \
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