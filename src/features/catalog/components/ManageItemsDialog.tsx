import { useMemo, useState, type FormEvent } from "react";
import { Icon } from "../../../shared/components/Icon";
import { useInventoryStore } from "../../../stores/inventoryStore";
import { useItemProfileStore } from "../../../stores/itemProfileStore";
import { useTimelineItemStore } from "../../../stores/timelineItemStore";
import {
  defaultBaseUnitForTemplate,
  defaultProfileName,
  groupLabels,
  itemProfileBaseUnit,
  managementTemplateLabels,
  standardTypeLabels,
  templatesByGroup,
  typesByTemplate
} from "../catalog";
import type {
  EyeSide,
  ManagementTemplate,
  StandardType
} from "../catalog.types";
import type { TimelineGroupId } from "../../timeline/timeline.types";
import {
  createProfile,
  deleteProfile,
  moveProfile,
  setProfileActive,
  updateProfile
} from "../profileRepository";
import styles from "./ManageItemsDialog.module.css";

interface ManageItemsDialogProps {
  onClose: () => void;
}

const groups: TimelineGroupId[] = ["lenses", "periodic", "consumables"];

export function ManageItemsDialog({ onClose }: ManageItemsDialogProps) {
  const profiles = useItemProfileStore((state) => state.profiles);
  const products = useInventoryStore((state) => state.products);
  const timelineItems = useTimelineItemStore((state) => state.items);

  const [groupId, setGroupId] = useState<TimelineGroupId>("lenses");
  const [showCreate, setShowCreate] = useState(false);
  const [template, setTemplate] = useState<ManagementTemplate>("rigid_long_term");
  const [standardType, setStandardType] = useState<StandardType>("scleral");
  const [standardTypeName, setStandardTypeName] = useState(
    standardTypeLabels.scleral
  );
  const [customStandardTypeName, setCustomStandardTypeName] = useState(false);
  const [side, setSide] = useState<EyeSide>("L");
  const [durationDays, setDurationDays] = useState(14);
  const [baseUnit, setBaseUnit] = useState("片");
  const [name, setName] = useState("巩膜镜（L）");
  const [customName, setCustomName] = useState(false);
  const [editingProfileId, setEditingProfileId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const groupProfiles = useMemo(
    () =>
      profiles
        .filter((profile) => profile.groupId === groupId)
        .sort((a, b) => a.order - b.order),
    [groupId, profiles]
  );

  function setGeneratedName(
    nextType: StandardType,
    nextSide = side,
    nextDuration = durationDays,
    nextStandardTypeName = standardTypeName,
    nextCustomStandardTypeName = customStandardTypeName
  ) {
    if (!customName) {
      const needsSide = groupId === "lenses";
      setName(
        defaultProfileName(
          nextType,
          needsSide ? nextSide : undefined,
          nextDuration,
          nextCustomStandardTypeName ? nextStandardTypeName : undefined
        )
      );
    }
  }

  function selectGroup(nextGroup: TimelineGroupId) {
    const nextTemplate = templatesByGroup[nextGroup][0]!;
    const nextType = typesByTemplate[nextTemplate][0]!;
    setGroupId(nextGroup);
    setTemplate(nextTemplate);
    setBaseUnit(defaultBaseUnitForTemplate(nextTemplate));
    setStandardType(nextType);
    setStandardTypeName(standardTypeLabels[nextType]);
    setCustomStandardTypeName(false);
    setCustomName(false);
    setName(defaultProfileName(nextType, nextGroup === "lenses" ? side : undefined, durationDays));
    setShowCreate(false);
    setEditingProfileId(null);
  }

  function selectTemplate(nextTemplate: ManagementTemplate) {
    const nextType = typesByTemplate[nextTemplate][0]!;
    setTemplate(nextTemplate);
    setBaseUnit(defaultBaseUnitForTemplate(nextTemplate));
    setStandardType(nextType);
    setStandardTypeName(standardTypeLabels[nextType]);
    setCustomStandardTypeName(false);
    setCustomName(false);
    setName(defaultProfileName(nextType, groupId === "lenses" ? side : undefined, durationDays));
  }

  function beginCreate() {
    const nextTemplate = templatesByGroup[groupId][0]!;
    const nextType = typesByTemplate[nextTemplate][0]!;
    setEditingProfileId(null);
    setTemplate(nextTemplate);
    setStandardType(nextType);
    setStandardTypeName(standardTypeLabels[nextType]);
    setCustomStandardTypeName(false);
    setSide("L");
    setDurationDays(nextTemplate === "soft_reusable" ? 14 : 90);
    setBaseUnit(defaultBaseUnitForTemplate(nextTemplate));
    setCustomName(false);
    setName(
      defaultProfileName(
        nextType,
        groupId === "lenses" ? "L" : undefined,
        nextTemplate === "soft_reusable" ? 14 : 90
      )
    );
    setShowCreate(true);
  }

  function beginEdit(profileId: string) {
    const profile = profiles.find((item) => item.id === profileId);
    if (!profile) return;
    const typeName =
      profile.standardTypeName ?? standardTypeLabels[profile.standardType];
    const isCustomTypeName = !typesByTemplate[profile.managementTemplate].some(
      (type) => standardTypeLabels[type] === typeName
    );
    const nextSide = profile.side ?? "L";
    const nextDuration = profile.defaultDurationDays ?? 90;
    const generatedName = defaultProfileName(
      profile.standardType,
      profile.groupId === "lenses" ? nextSide : undefined,
      nextDuration,
      isCustomTypeName ? typeName : undefined
    );
    setEditingProfileId(profile.id);
    setTemplate(profile.managementTemplate);
    setStandardType(profile.standardType);
    setStandardTypeName(typeName);
    setCustomStandardTypeName(isCustomTypeName);
    setSide(nextSide);
    setDurationDays(nextDuration);
    setBaseUnit(itemProfileBaseUnit(profile));
    setName(profile.name);
    setCustomName(profile.name !== generatedName);
    setShowCreate(true);
  }

  function closeForm() {
    setShowCreate(false);
    setEditingProfileId(null);
    setCustomName(false);
    setCustomStandardTypeName(false);
  }

  function profileHasRelations(profileId: string) {
    const profile = profiles.find((item) => item.id === profileId);
    if (!profile) return false;
    return (
      products.some(
        (product) =>
          product.itemProfileId === profile.id ||
          (!product.itemProfileId && product.standardType === profile.standardType)
      ) || timelineItems.some((item) => item.categoryId === profile.id)
    );
  }

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const editingProfile = editingProfileId
      ? profiles.find((profile) => profile.id === editingProfileId)
      : undefined;
    const hasRelations = editingProfileId
      ? profileHasRelations(editingProfileId)
      : false;
    const editableFields = {
      standardType:
        hasRelations && editingProfile ? editingProfile.standardType : standardType,
      standardTypeName: standardTypeName.trim(),
      name: name.trim(),
      baseUnit: baseUnit.trim(),
      ...(groupId === "lenses"
        ? {
            side:
              hasRelations && editingProfile?.side ? editingProfile.side : side
          }
        : {}),
      ...(template === "soft_reusable" ||
      template === "lens_case" ||
      template === "lens_accessory"
        ? { defaultDurationDays: durationDays }
        : {})
    };
    try {
      if (editingProfileId) {
        await updateProfile(editingProfileId, editableFields);
      } else {
        await createProfile({
          groupId,
          managementTemplate: template,
          ...editableFields
        });
      }
      setActionError(null);
      closeForm();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "保存用品配置失败");
    }
  }

  async function runAction(action: () => Promise<unknown>) {
    try {
      await action();
      setActionError(null);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "更新用品配置失败");
    }
  }

  return (
    <div className={styles.backdrop}>
      <section aria-label="管理用品配置" className={styles.dialog}>
        <header className={styles.heading}>
          <div>
            <span>用品与状态</span>
            <h2>管理用品</h2>
            <p>用品配置决定时间轴左侧显示哪些行。</p>
          </div>
          <button aria-label="关闭管理用品" onClick={onClose} type="button">
            <Icon name="close" />
          </button>
        </header>

        <nav aria-label="用品大类" className={styles.groupTabs}>
          {groups.map((group) => (
            <button
              className={group === groupId ? styles.groupTabActive : styles.groupTab}
              key={group}
              onClick={() => selectGroup(group)}
              type="button"
            >
              {groupLabels[group]}
              <small>{profiles.filter((profile) => profile.groupId === group).length}</small>
            </button>
          ))}
        </nav>

        <div className={styles.listHeading}>
          <div>
            <strong>{groupLabels[groupId]}配置</strong>
            <span>拖动排序将在后续版本加入，当前使用上下按钮调整。</span>
          </div>
          <button
            className={styles.createButton}
            onClick={() => (showCreate ? closeForm() : beginCreate())}
            type="button"
          >
            <Icon name="plus" size={16} />
            新建配置
          </button>
        </div>

        {actionError && <p className={styles.actionError} role="alert">{actionError}</p>}

        {showCreate && (
          <form className={styles.createForm} onSubmit={handleSave}>
            <label>
              管理模板
              <select
                disabled={editingProfileId !== null}
                onChange={(event) =>
                  selectTemplate(event.target.value as ManagementTemplate)
                }
                value={template}
              >
                {templatesByGroup[groupId].map((item) => (
                  <option key={item} value={item}>
                    {managementTemplateLabels[item]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              标准类型
              <select
                disabled={
                  editingProfileId !== null && profileHasRelations(editingProfileId)
                }
                onChange={(event) => {
                  if (event.target.value === "custom") {
                    setCustomStandardTypeName(true);
                    setStandardTypeName("");
                    setGeneratedName(
                      standardType,
                      side,
                      durationDays,
                      "",
                      true
                    );
                    return;
                  }
                  const nextType = event.target.value as StandardType;
                  const nextName = standardTypeLabels[nextType];
                  setStandardType(nextType);
                  setStandardTypeName(nextName);
                  setCustomStandardTypeName(false);
                  setGeneratedName(
                    nextType,
                    side,
                    durationDays,
                    nextName,
                    false
                  );
                }}
                value={customStandardTypeName ? "custom" : standardType}
              >
                {typesByTemplate[template].map((item) => (
                  <option key={item} value={item}>
                    {standardTypeLabels[item]}
                  </option>
                ))}
                <option value="custom">其他（自定义）</option>
              </select>
            </label>
            {customStandardTypeName && (
              <label>
                自定义标准类型名称
                <input
                  autoFocus
                  onChange={(event) => {
                    const nextName = event.target.value;
                    setStandardTypeName(nextName);
                    setGeneratedName(
                      standardType,
                      side,
                      durationDays,
                      nextName,
                      true
                    );
                  }}
                  placeholder="请输入标准类型名称"
                  required
                  value={standardTypeName}
                />
              </label>
            )}
            {groupId === "lenses" && (
              <label>
                眼别
                <select
                  disabled={
                    editingProfileId !== null && profileHasRelations(editingProfileId)
                  }
                  onChange={(event) => {
                    const nextSide = event.target.value as EyeSide;
                    setSide(nextSide);
                    setGeneratedName(standardType, nextSide);
                  }}
                  value={side}
                >
                  <option value="L">左眼（L）</option>
                  <option value="R">右眼（R）</option>
                </select>
              </label>
            )}
            <label>
              基础单位
              <input
                list="profile-base-unit-options"
                maxLength={8}
                onChange={(event) => setBaseUnit(event.target.value)}
                placeholder="例如：瓶、个、片"
                required
                value={baseUnit}
              />
              <datalist id="profile-base-unit-options">
                {["瓶", "个", "片", "对", "支", "盒", "包"].map((unit) => (
                  <option key={unit} value={unit} />
                ))}
              </datalist>
            </label>
            {(template === "soft_reusable" ||
              template === "lens_case" ||
              template === "lens_accessory") && (
              <label>
                默认周期（天）
                <input
                  min="1"
                  onChange={(event) => {
                    const nextDuration = Math.max(1, Number(event.target.value));
                    setDurationDays(nextDuration);
                    setGeneratedName(standardType, side, nextDuration);
                  }}
                  type="number"
                  value={durationDays}
                />
              </label>
            )}
            <label className={styles.nameField}>
              显示名称
              <input
                onChange={(event) => {
                  setCustomName(true);
                  setName(event.target.value);
                }}
                required
                value={name}
              />
            </label>
            <div className={styles.formActions}>
              <button onClick={closeForm} type="button">
                取消
              </button>
              <button className={styles.saveButton} type="submit">
                {editingProfileId ? "保存配置" : "创建配置行"}
              </button>
            </div>
          </form>
        )}

        <div className={styles.profileList}>
          {groupProfiles.map((profile, index) => (
            <article className={styles.profileRow} key={profile.id}>
              <div className={styles.orderButtons}>
                <button
                  aria-label={`上移${profile.name}`}
                  disabled={index === 0}
                  onClick={() => void runAction(() => moveProfile(profile.id, -1))}
                  type="button"
                >
                  ↑
                </button>
                <button
                  aria-label={`下移${profile.name}`}
                  disabled={index === groupProfiles.length - 1}
                  onClick={() => void runAction(() => moveProfile(profile.id, 1))}
                  type="button"
                >
                  ↓
                </button>
              </div>
              <div className={styles.profileMain}>
                <strong>{profile.name}</strong>
                <span>
                  {managementTemplateLabels[profile.managementTemplate]} ·{" "}
                  {profile.standardTypeName ?? standardTypeLabels[profile.standardType]}
                  {profile.side ? ` · ${profile.side}` : ""}
                  {` · 单位：${itemProfileBaseUnit(profile)}`}
                </span>
              </div>
              <span className={profile.active ? styles.activeBadge : styles.inactiveBadge}>
                {profile.active ? "使用中" : "已停用"}
              </span>
              <div className={styles.rowActions}>
                <button onClick={() => beginEdit(profile.id)} type="button">
                  编辑
                </button>
                <button
                  onClick={() => void runAction(() => setProfileActive(profile.id, !profile.active))}
                  type="button"
                >
                  {profile.active ? "停用" : "启用"}
                </button>
                <button
                  disabled={profileHasRelations(profile.id)}
                  onClick={() => void runAction(() => deleteProfile(profile.id))}
                  title={
                    profileHasRelations(profile.id)
                      ? "已有产品或时间轴记录，不能删除"
                      : "删除配置"
                  }
                  type="button"
                >
                  删除
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
