# Person-Bound Garment Color: Runtime Research

Checked 2026-10-13. Sidecar research for the local second-round campus-photo benchmark only. Official cards, docs, metadata and source inspected; no production access, model downloads, inference, implementation changes, or browser launches. Everything below marked "proposed" is an evaluation design, not a measured capability.

## Bottom Line

DETR can propose person boxes; SegFormer can propose garment pixels. Neither establishes which detected face owns which body, and neither predicts garment color. SegFormer is semantic, not instance segmentation: cropping to a person box reduces context but does not exclude an overlapping person's clothes. The proposed chain is useful for diagnostics, not proof of ownership. [DETR API][detr-doc], [SegFormer API][seg-doc]

## Verified Runtime And API

Source reference: Transformers **v4.57.1**, not a claim about the installed or latest runtime. Pin the actual tested environment separately.

| Component | Official evidence and runtime contract |
| --- | --- |
| Model revisions | Metadata resolves `mattmdjaga/segformer_b2_clothes` main to `584abc1e1d260e23c0fc627c5217a09b2b461046`; `facebook/detr-resnet-50` **`no_timm`** to `70120ba84d68ca1211e007c4fb61d0cd5424be54`. Use the same explicit revision for each model and its processor; do not silently substitute DETR main. [SegFormer metadata][seg-meta], [DETR metadata][detr-meta] |
| DETR loading | `DetrImageProcessor`/`AutoImageProcessor` plus `DetrForObjectDetection`/`AutoModelForObjectDetection`, via `from_pretrained(..., revision=...)`. Branch config sets `use_timm_backbone=false`, native ResNet stages `[3,4,6,3]`, output `stage4`, and 100 queries. Source gates the timm path on that flag. This removes the timm backbone dependency, not all runtime dependencies. [Config][detr-config], [backbone source][detr-source] |
| DETR preprocessing/output | Saved processor uses shortest edge 800, longest edge cap 1333, rescaling, ImageNet normalization and padding. Forward returns class logits and normalized center-format boxes; `post_process_object_detection(outputs, target_sizes=[(H,W)], threshold=...)` returns `scores`, `labels`, absolute `xyxy` boxes. Resolve `person` through `id2label` (1 here). It is an object detector, not a face detector or person-mask model. [Processor config][detr-pre], [API][detr-doc], [labels][detr-config] |
| SegFormer loading/labels | `SegformerImageProcessor` plus `AutoModelForSemanticSegmentation`/`SegformerForSemanticSegmentation`. Config has 18 classes: background 0, upper-clothes 4, skirt 5, pants 6, dress 7, face 11, bag 16, scarf 17. The base checkpoint is `nvidia/mit-b2`. There is no "red" class, identity or per-person instance ID. [Config][seg-config] |
| SegFormer preprocessing/output | Saved processor specifies size 512, ImageNet normalization, legacy feature-extractor metadata and `reduce_labels=false`; v4.57.1's slow processor uses square resizing. Keep class 0 as background, not an ADE20K-style shifted taxonomy. `post_process_semantic_segmentation(outputs, target_sizes=[(crop_H,crop_W)])` bilinearly resizes logits before argmax. It returns class IDs, not calibrated confidence; retain logits separately for uncertainty diagnostics. Restore crop offsets when comparing masks to full-image faces/boxes. [Processor config][seg-pre], [processor source][seg-source] |

**Serialization/security:** SegFormer lists a roughly 109 MB safetensors checkpoint. The pinned DETR branch lists only `pytorch_model.bin` (roughly 167 MB), despite repository-level safetensors badges; forcing `use_safetensors=True` at that revision fails rather than supplying a branch-equivalent checkpoint. In the inspected runtime, normal `.bin` loading with `weights_only=True` requires **PyTorch >=2.6**. Do not bypass the safety check with `weights_only=False` or an older unsafe loader. Prefer SegFormer's safetensors; preserve exact artifact provenance for DETR. Weight sizes are not peak-memory estimates. [SegFormer files][seg-files], [DETR branch files][detr-files], [load guard][load-guard], [loader][loader]

**Proposed runtime discipline:** PyTorch, Transformers, Pillow/NumPy and required dependencies; explicitly select processor backend (`use_fast=False` for these slow-processor contracts), device and dtype. Use evaluation/inference mode, batch size 1 initially, and preserve original RGB pixels for color analysis, not normalized tensors. Pin software versions and record CPU/MPS/CUDA fallback. `from_pretrained` can fetch files; a later approved offline run should use prepared local artifacts with `local_files_only=True`. No speed, memory or accelerator compatibility is established here. [Loading options][loading-doc], [processor backend source][processor-source]

## License Limits

- **SegFormer: not MIT or commercially cleared.** Card says `license: other` and links NVIDIA's SegFormer license. Section 3.3 restricts use to non-commercial research/evaluation; sections 3.1-3.2 retain redistribution and derivative-work obligations. Treat this as a research/evaluation candidate only, subject to applicable terms, not production permission. [Card][seg-card], [NVIDIA license][seg-license]
- **DETR:** card declares Apache-2.0; original repository carries Apache-2.0. Commercial use is not categorically prohibited, but redistribution requires license/notices and modification notices as applicable. This does not clear other components or campus-photo/person-data rights. [Card][detr-card], [License][detr-license]
- **Training data:** SegFormer card identifies ATR; ATR's authors describe annotated fashion images and request citation for research use. That is not proof of campus-domain coverage or a comprehensive downstream rights clearance. [ATR authors][atr]

## Ownership And Crowded-Scene Pitfalls

The following are **engineering risk inferences**, not measured error rates:

- DETR has 100 object-query slots across all classes, not a guarantee of detecting 100 people. Small, distant, occluded, truncated or overlapping people need separate testing. Training-time Hungarian matching aligns predictions to annotations; it does **not** bind faces to bodies. [Config][detr-config], [training description][detr-card]
- Face containment or nearest-body center can attach a front-row face to a rear-row torso. Seated people, leaning heads, hugs and duplicate/merged boxes break simple top-of-box rules. A face's identity confidence is distinct from body-ownership confidence; the parsing class "Face" does not recognize identity.
- Proposed binding diagnostics: score all plausible face/body pairs using containment, scale and head-position plausibility; require an absolute threshold and best-versus-runner-up margin. One-to-one assignment needs explicit unmatched options, never forced matches. One body containing multiple plausible faces or several plausible bodies for one face should normally abstain. These are heuristics to test, not validated anatomy.
- A person rectangle is not a silhouette. Its garment mask can include a neighbor's red sleeve or background misclassified as clothing. Proposed conservative handling: flag/discard contested pixels and record lost coverage; if insufficient owned garment remains, return `unknown`. Connected components alone cannot prove ownership.
- Define the query's garment scope before testing: upper-clothes/dress versus any clothing. Exclude skin, bags and accessories unless explicitly requested. Measure color only on eligible owned pixels in the original RGB crop. Red hue wraps around the hue range; low saturation, shadows, white balance, lighting, patterns and compression require separate checks. A low red-pixel fraction on a tiny/occluded mask is not evidence of non-red.

The card reports SegFormer mean IoU 0.69 (upper-clothes 0.78, dress 0.55, scarf 0.29); DETR's card reports COCO AP 42.0. These are reported source-task metrics, **not** campus retrieval accuracy, calibrated ownership probabilities or red-background rejection rates. [SegFormer evaluation][seg-card], [DETR evaluation][detr-card]

## Proposed Honest Diagnostic Protocol

1. **Freeze scope:** approved local sample manifest and hashes, query wording, identity reference, candidate universe, model revisions, preprocessing, crop/color policy and thresholds. Hold out evaluation photos by event/near-duplicate group; tune only on a separate development split. No production or external photo upload.
2. **Define states:** independently record identity, face/body binding, garment visibility and color. Final color is `red`, `non_red` or `unknown`, with reason codes such as `no_body`, `ambiguous_binding`, `insufficient_garment`, `low_confidence`, `runtime_error`. Define the visible garment scope; do not assert hidden-surface color. `non_red` requires affirmative adequate-visibility evidence. Neither missing detection, timeout nor a low score may become non-red; unknown must not satisfy a "not red" query.
3. **Stratify failure cases:** target red/non-red, red background without red target clothing, another red-clothed person beside/in front of target, target red with non-red neighbor, no target, several faces per crop, occlusion, seated poses, small figures, patterns and mixed illumination. These are planned strata until independently annotated, not asserted labels.
4. **Run controlled ablations later:** baseline color heuristic; person boxes + same color rule; boxes + ownership; boxes + ownership + garment masks. Keep candidate universe, color definition and held-out queries fixed. Report filter effects separately from ranking; a reranker cannot recover excluded candidates. Preserve overlays, competing bindings, eligible-pixel counts and scores for local inspection without publishing identities.
5. **Label evidence honestly:** model labels, geometry-derived checks, VLM judgments and cross-model agreement are **automated diagnostic judgments, not human ground truth**. Without independent human annotations, report coverage, abstention, disagreement, candidate retention and proxy changes only; do not call them true precision, recall or false-positive rates. Using the same model to judge its own output is circular. If later authorized, obtain blinded independent human judgments with an uncertain option and adjudication.
6. **Report all denominators:** requested/processed/failed photos and queries, detections, bindings, sufficiently visible garments, red/non-red/unknown decisions, and unknown reasons. With human references, separately report ownership error, background/neighbor-red false accepts, target-red false rejects, retrieval precision/recall@K, and selective accuracy versus coverage. Include unknowns and runtime failures in end-to-end accounting; never improve results by silently dropping them.
7. **Measure runtime separately:** cold load versus warm inference; detection, per-person parsing, binding/color and total latency (p50/p95), memory, crop count, device/dtype, and failures. Synchronize asynchronous accelerators around timing; show crowded-photo cost and sensitivity to thresholds. No runtime numbers or benchmark outcomes were produced by this research.

[seg-meta]: https://huggingface.co/api/models/mattmdjaga/segformer_b2_clothes/revision/main
[detr-meta]: https://huggingface.co/api/models/facebook/detr-resnet-50/revision/no_timm
[seg-card]: https://huggingface.co/mattmdjaga/segformer_b2_clothes/blob/584abc1e1d260e23c0fc627c5217a09b2b461046/README.md
[seg-config]: https://huggingface.co/mattmdjaga/segformer_b2_clothes/blob/584abc1e1d260e23c0fc627c5217a09b2b461046/config.json
[seg-pre]: https://huggingface.co/mattmdjaga/segformer_b2_clothes/blob/584abc1e1d260e23c0fc627c5217a09b2b461046/preprocessor_config.json
[seg-files]: https://huggingface.co/mattmdjaga/segformer_b2_clothes/tree/584abc1e1d260e23c0fc627c5217a09b2b461046
[seg-license]: https://github.com/NVlabs/SegFormer/blob/master/LICENSE
[atr]: https://github.com/lemondan/HumanParsing-Dataset
[detr-card]: https://huggingface.co/facebook/detr-resnet-50/blob/70120ba84d68ca1211e007c4fb61d0cd5424be54/README.md
[detr-config]: https://huggingface.co/facebook/detr-resnet-50/blob/70120ba84d68ca1211e007c4fb61d0cd5424be54/config.json
[detr-pre]: https://huggingface.co/facebook/detr-resnet-50/blob/70120ba84d68ca1211e007c4fb61d0cd5424be54/preprocessor_config.json
[detr-files]: https://huggingface.co/facebook/detr-resnet-50/tree/70120ba84d68ca1211e007c4fb61d0cd5424be54
[detr-license]: https://github.com/facebookresearch/detr/blob/main/LICENSE
[detr-doc]: https://huggingface.co/docs/transformers/v4.57.1/en/model_doc/detr
[seg-doc]: https://huggingface.co/docs/transformers/v4.57.1/en/model_doc/segformer
[detr-source]: https://github.com/huggingface/transformers/blob/v4.57.1/src/transformers/models/detr/modeling_detr.py#L247
[seg-source]: https://github.com/huggingface/transformers/blob/v4.57.1/src/transformers/models/segformer/image_processing_segformer.py#L427
[load-guard]: https://github.com/huggingface/transformers/blob/v4.57.1/src/transformers/utils/import_utils.py#L1645
[loader]: https://github.com/huggingface/transformers/blob/v4.57.1/src/transformers/modeling_utils.py#L507
[loading-doc]: https://huggingface.co/docs/transformers/v4.57.1/en/main_classes/model#transformers.PreTrainedModel.from_pretrained
[processor-source]: https://github.com/huggingface/transformers/blob/v4.57.1/src/transformers/models/auto/image_processing_auto.py#L410
