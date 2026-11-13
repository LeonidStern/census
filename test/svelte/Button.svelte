<script>
  let { variant = "primary", children } = $props();
</script>

<button class="btn {variant}">{@render children?.()}</button>
