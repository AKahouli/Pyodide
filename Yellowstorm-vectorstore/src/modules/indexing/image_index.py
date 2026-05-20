import base64
import json
import os  # Import the os module

import fitz
import requests
from PIL import Image
from langfuse.openai import OpenAI
from openai import OpenAIError

from src.config.settings import get_settings

settings = get_settings()

os.environ["LANGFUSE_PUBLIC_KEY"] = settings.LANGFUSE_PUBLIC_KEY
os.environ["LANGFUSE_SECRET_KEY"] = settings.LANGFUSE_PRIVATE_KEY
os.environ["LANGFUSE_HOST"] = settings.LANGFUSE_HOST


def convert_pdf_to_images(pdf_path, output_folder, dpi=300, image=True):
    """
    Converts a PDF to images. If 'image' is False, only the first 10 pages are converted.

    Parameters:
        pdf_path (str): Path to the input PDF file.
        output_folder (str): Folder where images will be saved.
        dpi (int, optional): Resolution for output images (default is 300).
        image (bool, optional): If False, only the first 10 pages are converted.

    Returns:
        List[str]: List of image file paths.
    """
    # Open the PDF file
    doc = fitz.open(pdf_path)
    os.makedirs(output_folder, exist_ok=True)
    imges = []

    # Determine number of pages to process
    num_pages = len(doc) if image else min(10, len(doc))

    # Iterate through selected pages
    for page_num in range(num_pages):
        # Get the page
        page = doc.load_page(page_num)

        # Specify the zoom factor based on the desired DPI. The default DPI in PyMuPDF is 72.
        zoom = dpi / 72
        mat = fitz.Matrix(zoom, zoom)

        # Get the Pixmap of the page with the zoom factor applied (higher resolution)
        pix = page.get_pixmap(matrix=mat)

        # Define the output image path
        output_image_path = f"{output_folder}/page_{page_num + 1}.png"

        # Save the image
        pix.save(output_image_path)

        imges.append(output_image_path)

    # Close the document
    doc.close()
    return imges


def run_docseg_model(image_path):
    image_layout_api_url = settings.IMAGE_LAYOUT_API_URL.unicode_string()
    result = []
    for img in image_path:
        response = requests.post(f"{image_layout_api_url}/paddle/images", files={"files": open(img, "rb")}).json()[0]
        result.append(response)

    return result


def calculate_area(box):
    return (box['x2'] - box['x1']) * (box['y2'] - box['y1'])


def overlaps(box_a, box_b):
    return not (box_a['x2'] < box_b['x1'] or box_a['x1'] > box_b['x2'] or
                box_a['y2'] < box_b['y1'] or box_a['y1'] > box_b['y2'])


def merge_boxes(boxes):
    if isinstance(boxes, dict):
        boxes = boxes.get("detections", [])

    merged_boxes = []
    skip_indices = set()

    for i, box_a in enumerate(boxes):
        if i in skip_indices:
            continue

        for j, box_b in enumerate(boxes[i + 1:], start=i + 1):
            if overlaps(box_a, box_b):
                skip_indices.add(j)
                new_box = {
                    "x1": min(box_a["x1"], box_b["x1"]),
                    "y1": min(box_a["y1"], box_b["y1"]),
                    "x2": max(box_a["x2"], box_b["x2"]),
                    "y2": max(box_a["y2"], box_b["y2"]),
                    "name": box_a["name"] if calculate_area(box_a) > calculate_area(box_b) else box_b["name"],
                    "confidence": max(box_a["confidence"], box_b["confidence"]),
                }
                box_a = new_box

        merged_boxes.append(box_a)

    return merged_boxes

def is_close_enough(text, image, max_distance=100):
    """Check if the text is within a maximum distance from the image in both x and y axes."""
    distance_above = image['y1'] - text['y2']
    distance_below = text['y1'] - image['y2']
    distance_left = image['x1'] - text['x2']
    distance_right = text['x1'] - image['x2']

    # If the text box overlaps with the image in x-axis, consider the distance as zero
    horizontal_distance = max(0, max(distance_left, distance_right))
    # If the text box overlaps with the image in y-axis, consider the distance as zero
    vertical_distance = max(0, max(distance_above, distance_below))

    return horizontal_distance <= max_distance and vertical_distance <= max_distance


def is_single_or_double_line(text, max_aspect_ratio=10):
    """Estimate if the text box likely contains one or two lines based on aspect ratio."""
    width = text['x2'] - text['x1']
    height = text['y2'] - text['y1']
    aspect_ratio = width / height if height > 0 else 0
    print(aspect_ratio)
    return aspect_ratio >= max_aspect_ratio


def find_and_merge_nearest_text(image_elements, text_elements, max_distance=300, max_aspect_ratio=10):
    available_text_elements = text_elements.copy()

    for image in image_elements:
        image_with_texts = image.copy()  # Copy the image dict
        found_above = False
        found_below = False
        i = 0  # Index for manual iteration

        while i < len(available_text_elements) and not (found_above and found_below):
            text = available_text_elements[i]

            # Check horizontal overlap and closeness
            if not (text['x2'] < image['x1'] or text['x1'] > image['x2']) and is_close_enough(text, image,
                                                                                              max_distance):
                if is_single_or_double_line(text, max_aspect_ratio):
                    # Determine position relative to image
                    if text['y2'] <= image['y1'] and not found_above:  # Text is above the image
                        found_above = True
                        # Merge and extend the bounding box
                        image_with_texts['y1'] = min(image_with_texts['y1'], text['y1'])
                    elif text['y1'] >= image['y2'] and not found_below:  # Text is below the image
                        found_below = True
                        # Merge and extend the bounding box
                        image_with_texts['y2'] = max(image_with_texts['y2'], text['y2'])

                    if found_above or found_below:
                        # Update the bounding box's x coordinates to include the text
                        image_with_texts['x1'] = min(image_with_texts['x1'], text['x1'])
                        image_with_texts['x2'] = max(image_with_texts['x2'], text['x2'])

                        # Remove the text element and adjust index
                        available_text_elements.pop(i)
                        continue  # Skip the increment of i to account for the removed item
            i += 1
        # Apply transformations with boundary conditions
        image_with_texts['x1'] = image_with_texts['x1'] - 100
        image_with_texts['y1'] = image_with_texts['y1'] - 100
        image_with_texts['x2'] = image_with_texts['x2'] + 100
        image_with_texts['y2'] = image_with_texts['y2'] + 100
        # Update the original image element
        image_index = image_elements.index(image)
        image_elements[image_index] = image_with_texts
    return image_elements


def delete_images_and_tables(pdf_path, layout_result, temp_folder):
    output_path = os.path.join(temp_folder, os.path.basename(f'{pdf_path}_no_img_pdf.pdf'))
    os.makedirs(temp_folder, exist_ok=True)

    doc = fitz.open(pdf_path)

    scale_factor = 300 / 72

    # PP-DocLayout visual elements we want to remove
    REMOVE_CLASSES = {
        "table",
        "image",
        "figure",
        "header",
        "footer",
        "header_image",
        "footer_image"
    }

    for page_number, res in enumerate(layout_result):

        page = doc.load_page(page_number)

        rects_to_redact = []

        for result in res["detections"]:

            label = result["name"].lower().replace("-", "_")

            rect = fitz.Rect(
                result["x1"] / scale_factor,
                result["y1"] / scale_factor,
                result["x2"] / scale_factor,
                result["y2"] / scale_factor
            )

            if label in REMOVE_CLASSES:
                rects_to_redact.append(rect)
                page.add_redact_annot(rect)

        try:
            page.apply_redactions()

        except Exception as exc:

            if "colorspaces supported" in str(exc):
                # fallback if colorspace not supported
                for rect in rects_to_redact:
                    shape = page.new_shape()
                    shape.draw_rect(rect)
                    shape.finish(color=(1, 1, 1), fill=(1, 1, 1))
                    shape.commit()
            else:
                raise

    doc.save(output_path)
    doc.close()

    return output_path


def extract_sub_image(image_path, boxes, page, output_folder, file_id):
    # Open the image
    image = Image.open(image_path)
    max_width, max_height = image.size
    # Create the output folder
    os.makedirs(output_folder, exist_ok=True)
    sub_image_list = []
    # Iterate through each box
    for i, box in enumerate(boxes):
        # Extract the sub-image
        sub_image = image.crop(
            (max(0, box['x1']), max(0, box['y1']), min(max_width, box['x2']), min(max_height, box['y2'])))

        # Save the sub-image
        sub_image.save(f"{output_folder}/{file_id}_{page}_sub_image_{i + 1}.png")
        sub_image_list.append(f"{output_folder}/{file_id}_{page}_sub_image_{i + 1}.png")
    return sub_image_list


# Function to encode the image
def encode_image(image_path):
    with open(image_path, "rb") as image_file:
        return base64.b64encode(image_file.read()).decode('utf-8')


def describe_image(image_path, language, user_id="unknown"):
    deployment_name = settings.OPENAI_API_VISION_DEPLOYMENT_NAME
    client = OpenAI(
        api_key=settings.LITELLM_API_KEY,
        base_url=settings.LITELLM_BASE_URL,

    )
    img = encode_image(image_path)
    response = client.chat.completions.create(name="Indexation - Image description",
                                              model=deployment_name,
                                              user=user_id,
                                              messages=[
                                                  {"role": "system", "content": "You are a helpful image interpreter."},
                                                  {"role": "user", "content": [
                                                      {
                                                          "type": "text",
                                                          "text": f"""Examine the attached image of a data visualization and provide a comprehensive analysis.
                    Describe the title and the overall topic it addresses. Detail the axes or segments, including their labels, scales, units of measurement, and ALL the numeric values.
                    and explain the significance of colors or symbols used. If there are any annotations, legends, or sources, please interpret their meaning and how they relate to the data presented. 
                    your reply should be in {language} language.
                    """
                                                      },
                                                      {
                                                          "type": "image_url",
                                                          "image_url": {
                                                              "url": f"data:image/jpeg;base64,{img}",
                                                              "detail": "high"
                                                          }
                                                      }
                                                  ]}
                                              ],
                                              max_tokens=32000
                                              )
    response = response.json()
    response = json.loads(response)
    return response['choices'][0]['message']['content']


def is_relevant_image(image_path, user_id="unknown"):
    deployment_name = settings.OPENAI_API_VISION_DEPLOYMENT_NAME
    client = OpenAI(
        api_key=settings.LITELLM_API_KEY,
        base_url=settings.LITELLM_BASE_URL,

    )
    img = encode_image(image_path)
    IMAGE_CLASSIFIER_PROMPT = """
        You will be presented with an image. Your task is to determine if the image contains relevant content or not.

        A relevant image is defined as follows:
        - It contains full text.
        - It includes a table.
        - It features diagrams or charts.
        - It provides any relevant, self-contained information.

        An image is deemed irrelevant if:
        - It only consists of titles or subtitles.
        - It contains irrelevant information.
        - It displays content tables.

        You Must return "True" if the image is relevant or "False" if it is not. without any additional word .
        You Only return "True" or  "False".


        Answer:

        """
    try:
        completion = client.chat.completions.create(name="Indexation - Image classifier", model=deployment_name,
                                                    user=user_id,
                                                    messages=[
                                                        {"role": "user", "content": [
                                                            {"type": "text", "text": IMAGE_CLASSIFIER_PROMPT}]},
                                                        {"role": "user", "content": [
                                                            {
                                                                "type": "image_url",
                                                                "image_url": {
                                                                    "url": f"data:image/jpeg;base64,{img}",
                                                                    "detail": "low"
                                                                }
                                                            }]}],
                                                    )
    except OpenAIError:
        return False

    return eval(completion.choices[0].message.content)


def is_summary(image_path,user_id="unknown"):
    # client = OpenAI(
    #     api_key=settings.LITELLM_API_KEY,
    #     base_url=settings.LITELLM_BASE_URL,
    #
    # )
    # img = encode_image(image_path)
    # Summary_prompt = """
    #     You will be presented with an image. Your task is to determine if the image contains a document summary or table of content page or not.
    #      summaries contain only titles and subtitles    otherwise it's not considered a summary page.
    #
    #
    #
    #     You Must return "True" if the image contains a summary page or "False" if it does not. without any additional word .
    #     You Only return "True" or  "False".
    #
    #
    #     Answer:
    #
    #     """
    # try:
    #     completion = client.chat.completions.create(name="Indexation - Summary checker",
    #                                                 model=settings.OPENAI_API_VISION_DEPLOYMENT_NAME,
    #                                                 user=user_id,
    #                                                 messages=[
    #                                                     {"role": "user", "content": [
    #                                                         {"type": "text", "text": Summary_prompt}]},
    #                                                     {"role": "user", "content": [
    #                                                         {
    #                                                             "type": "image_url",
    #                                                             "image_url": {
    #                                                                 "url": f"data:image/jpeg;base64,{img}",
    #                                                                 "detail": "low"
    #                                                             }
    #                                                         }]}],
    #                                                 )
    # except OpenAIError:
    #     return False
    #
    # return eval(completion.choices[0].message.content)
    return False


def remove_summary_pages(pdf_path: str, summary_pages: list) -> str:
    """
    Replaces pages identified as summary with blank pages instead of removing them,
    while keeping the rest of the document intact.

    Parameters:
        pdf_path (str): Path to the input PDF.
        summary_pages (list): List of zero-based indices of pages to replace.

    Returns:
        str: Path to the modified PDF.
    """
    doc = fitz.open(pdf_path)
    new_doc = fitz.open()

    for i in range(len(doc)):
        if i in summary_pages:
            original_rect = doc[i].rect
            blank_page = new_doc.new_page(width=original_rect.width, height=original_rect.height)
        else:
            new_doc.insert_pdf(doc, from_page=i, to_page=i)

    # Save the modified PDF
    new_pdf_path = pdf_path.replace(".pdf", "_filtered.pdf")
    new_doc.save(new_pdf_path)
    new_doc.close()
    doc.close()

    return new_pdf_path


def replace_with_blank_image(image_path: str):
    """
    Replaces the given image with a blank (white) image of the same dimensions.

    Parameters:
        image_path (str): Path to the image file that needs to be replaced.
    """
    try:
        original_img = Image.open(image_path)  # Open the original image
        blank_img = Image.new("RGB", original_img.size, (255, 255, 255))  # Create a blank white image
        blank_img.save(image_path)  # Overwrite original image with blank image
    except Exception as e:
        print(f"Error replacing {image_path} with a blank image: {e}")
