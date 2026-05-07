from zai import ZaiClient

client = ZaiClient(api_key="1d079cfa326d44b9a9cca35e61c85562.A2yewyNkQRlMsa0X")  # Fill in your own APIKey

response = client.web_search.web_search(
   search_engine="search-prime",
   search_query="search economic events",
   count=15, # The number of results to return, ranging from 1-50, default 10
   search_domain_filter="www.sohu.com", # Only access content from specified domain names.
   search_recency_filter="noLimit", # Search for content within specified date ranges
)
print(response)