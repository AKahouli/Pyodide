from azure.storage.filedatalake import DataLakeServiceClient, DataLakeFileClient
from src.logger.logging import get_logger
from src.config.settings import get_settings
import os

settings = get_settings()
logger = get_logger("api.main")


class AzureDataLake:
    def __init__(self, directory_path: str):
        logger.info(f"Initializing AzureDataLake client for directory: {directory_path}")
        try:
            self.directory_path = directory_path
            self.container_name = settings.AZURE_DATALAKE_FILE_SYSTEM_NAME
            self.account_url = (
                f"https://{settings.AZURE_STORAGE_ACCOUNT}.dfs.core.windows.net"
            )
            self.datalake_service_client = DataLakeServiceClient(
                account_url=self.account_url,
                credential=settings.AZURE_STORAGE_ACCOUNT_KEY,
            )
            self.container_client = self.datalake_service_client.get_file_system_client(
                file_system=self.container_name
            )
            self.directory_client = self.container_client.get_directory_client(
                self.directory_path
            )
            logger.info("Azure Data Lake client initialized successfully")
        except Exception as e:
            logger.exception(f"error occured in init AzureDataLake: {e}")

    def upload_from_datalake(self, local_path: str, file_name: str):
        """upload a local file to azure datalake
        Args:
            local_path (str): path du fichier en locale
            file_name (str): nom du fichier à uploader
        """
        logger.info(f"Starting upload to Azure Data Lake - file: {file_name}")
        try:
            logger.info(f"Creating file client and uploading: {local_path}")
            file_client = self.directory_client.get_file_client(file_name)
            with open(file=local_path, mode="rb") as data:
                file_client.upload_data(data, overwrite=True)
                logger.info(f"File '{file_name}' uploaded successfully from {local_path}")
                return file_name
        except Exception as e:
            logger.exception(f"failed to upload file to datalake: {e}")


def download_from_datalake(file_path_adl: str, download_id: str):
    logger.info(f"Starting download from Azure Data Lake - file: {file_path_adl}, download_id: {download_id}")
    try:
        file = DataLakeFileClient.from_connection_string(
            settings.AZURE_DATALAKE_CONNECTION_STRING,
            file_system_name=settings.AZURE_DATALAKE_FILE_SYSTEM_NAME,
            file_path=file_path_adl,
        )
        temp_folder = os.path.join(settings.TEMP_FOLDER, download_id)
        output_path = os.path.join(temp_folder, os.path.basename(file_path_adl))
        logger.info(f"Creating temp folder: {temp_folder}")
        os.makedirs(temp_folder, exist_ok=True)
        logger.info(f"Finished creating temp folder: {temp_folder}")
        logger.info(f"Downloading file to {output_path}")
        with open(output_path, "wb") as my_file:
            download = file.download_file()
            download.readinto(my_file)

        logger.info("Finished writing to file")
        return output_path
    except Exception as e:
        logger.exception(f"error occured in download_from_datalake: {e}")
        raise e